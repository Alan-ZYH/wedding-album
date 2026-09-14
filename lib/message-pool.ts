import { FieldValue, Transaction, DocumentReference } from 'firebase-admin/firestore'
import { adminDb, COLLECTIONS } from './firebase-admin'
import { getSettings } from './settings'
import type { Message, MessageDisplayState } from '@/types'

/**
 * The danmaku rotation: a fixed number of blessings cycling on screen.
 *
 * A new blessing waits in a queue and flies ahead of the rotation. Only once it
 * has flown does it enter the rotation, pushing out the oldest blessing there —
 * which, being in the rotation, has flown too. So a surge of blessings delays
 * some of them, but none is pushed out before anyone saw it. Pinned blessings
 * take slots too but are never pushed out, so pins are capped at the size.
 *
 * Everything here runs on every blessing posted all evening, on a project
 * whose free plan shares 50,000 reads a day. So occupancy is a count
 * aggregation (~1 read) and "the oldest playing blessing" is an ordered query
 * on `playingSince`, a field that exists only while playing — Firestore leaves
 * documents without the field out of the ordering, so it needs neither a
 * composite index nor a read of the whole rotation.
 */

const messages = () => adminDb.collection(COLLECTIONS.MESSAGES)

export class PinLimitError extends Error {
  constructor(public limit: number) {
    super(`置頂已滿（上限 ${limit} 則），請先取消其他置頂`)
  }
}

/** Every slot is pinned, so nothing playing can be pushed out to make room. */
export class RotationFullError extends Error {
  constructor(public limit: number) {
    super(`輪播池 ${limit} 則都是置頂，請先取消置頂或調高祝福輪播數量`)
  }
}

const inRotation = (s?: MessageDisplayState) => s === 'pinned' || s === 'playing'

/** Fields that take a blessing out of rotation. */
export const LEAVE_ROTATION = {
  displayState: 'masked' as const,
  playingSince: FieldValue.delete(),
}

/**
 * Put a blessing into rotation — as playing, or pinned — evicting the oldest
 * playing blessings as needed. `create` writes a brand-new document inside the
 * same transaction, so a post and its admission can never half-happen.
 */
export async function admitMessage(opts: {
  ref: DocumentReference
  as: 'playing' | 'pinned'
  create?: Omit<Message, 'displayState' | 'displayStateAt' | 'playingSince'>
  extra?: Record<string, unknown>
  /** Only act if the blessing is still in this state (checked in the transaction) */
  onlyFrom?: MessageDisplayState
}): Promise<{ evicted: number; skipped?: boolean }> {
  const { messageCarouselSize: size = 20 } = await getSettings()
  const now = new Date().toISOString()

  return adminDb.runTransaction(async (tx) => {
    const [occupiedAgg, pinnedAgg, current] = await Promise.all([
      tx.get(messages().where('displayState', 'in', ['pinned', 'playing']).count()),
      tx.get(messages().where('displayState', '==', 'pinned').count()),
      opts.create ? Promise.resolve(null) : tx.get(opts.ref),
    ])
    const state = current?.data()?.displayState as MessageDisplayState | undefined
    if (opts.onlyFrom && (state !== opts.onlyFrom || current?.data()?.status !== 'active')) {
      return { evicted: 0, skipped: true }
    }
    let occupied = occupiedAgg.data().count
    const pinned = pinnedAgg.data().count

    if (opts.as === 'pinned' && state !== 'pinned' && pinned >= size) {
      throw new PinLimitError(size)
    }

    // A blessing already in rotation changes role without taking a new slot
    if (!inRotation(state)) occupied += 1
    const overflow = Math.max(0, occupied - size)
    const evicted = overflow > 0 ? await evictOldest(tx, overflow, opts.ref.id) : 0

    if (evicted < overflow) {
      // Pins fill the rotation. A guest's blessing is still kept — it just
      // waits out of rotation, where 播放 can bring it back later — but an
      // admin asking for something to play is told why it cannot.
      if (!opts.create) throw new RotationFullError(size)
      tx.set(opts.ref, { ...opts.create, displayState: 'masked', displayStateAt: now, ...opts.extra })
      return { evicted }
    }

    if (opts.create) {
      // A new document just omits playingSince when pinned — FieldValue.delete()
      // is only valid in an update
      tx.set(opts.ref, {
        ...opts.create,
        displayState: opts.as,
        displayStateAt: now,
        ...(opts.as === 'playing' ? { playingSince: now } : {}),
        ...opts.extra,
      })
    } else {
      tx.update(opts.ref, {
        displayState: opts.as,
        displayStateAt: now,
        playingSince: opts.as === 'playing' ? now : FieldValue.delete(),
        queueOrder: FieldValue.delete(),
        ...opts.extra,
      })
    }
    return { evicted }
  })
}

/** Fields that put a blessing in the queue. `front` is 播放's jump ahead. */
export function queueFields(front = false) {
  const now = Date.now()
  return {
    displayState: 'pending' as const,
    displayStateAt: new Date(now).toISOString(),
    queueOrder: front ? -now : now,
  }
}

/** 播放: back into the queue, ahead of every guest's blessing. */
export async function requeueMessage(ref: DocumentReference, extra: Record<string, unknown> = {}) {
  await ref.update({ ...queueFields(true), playingSince: FieldValue.delete(), ...extra })
}

/**
 * The screen reports a queued blessing has flown: it joins the rotation now,
 * pushing out the oldest there. Ignored unless it is still queued — a second
 * report, or one arriving after an admin removed it, changes nothing. If pins
 * fill the rotation it has still been seen, so it simply steps out.
 */
export async function promoteFlown(ref: DocumentReference): Promise<'promoted' | 'skipped' | 'no-room'> {
  try {
    const r = await admitMessage({ ref, as: 'playing', onlyFrom: 'pending' })
    return r.skipped ? 'skipped' : 'promoted'
  } catch (err) {
    if (!(err instanceof RotationFullError)) throw err
    await ref.update({ ...LEAVE_ROTATION, queueOrder: FieldValue.delete(), displayStateAt: new Date().toISOString() })
    return 'no-room'
  }
}

/** The oldest `n` playing blessings leave rotation. Returns how many did. */
async function evictOldest(tx: Transaction, n: number, exceptId: string): Promise<number> {
  const oldest = await tx.get(messages().orderBy('playingSince').limit(n + 1))
  const victims = oldest.docs.filter((d) => d.id !== exceptId).slice(0, n)
  for (const d of victims) tx.update(d.ref, LEAVE_ROTATION)
  return victims.length
}

/** Pinned → playing. Occupancy is unchanged, so nothing else moves. */
export async function unpinMessage(ref: DocumentReference) {
  const now = new Date().toISOString()
  await ref.update({ displayState: 'playing', displayStateAt: now, playingSince: now })
}

/**
 * Shrinking 祝福輪播數量 pushes the oldest playing blessings out until the
 * rotation fits. Pins stay; if pins alone exceed the new size, nothing else
 * plays. Returns how many left.
 */
export async function enforceMessageCapacity(size: number): Promise<number> {
  return adminDb.runTransaction(async (tx) => {
    const agg = await tx.get(messages().where('displayState', 'in', ['pinned', 'playing']).count())
    const overflow = agg.data().count - size
    return overflow > 0 ? evictOldest(tx, overflow, '') : 0
  })
}
