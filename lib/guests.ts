import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, COLLECTIONS } from './firebase-admin'
import { Guest } from '@/types'
import type { PhotoLimits } from './upload-limits'

/**
 * Guest gating: blocking + upload cooldown.
 *
 * The cooldown is a burst window rather than a hard "one per 30s": guests may
 * send up to `burst` items inside a `windowSec` window, which lets a 3-photo
 * batch through as a single action while still stopping a 4th photo.
 *
 * The window clock only advances on SUCCESS (recordGuestAction is called from
 * upload/complete, never from init), so failed uploads are not penalised.
 */
export const COOLDOWN = {
  // Photo defaults only — the live values come from 設定 via photoLimits()
  photo: { windowSec: 30, burst: 3 },
  message: { windowSec: 30, burst: 1 },
  album: { windowSec: 30, burst: 100 },
} as const

/** Where each action keeps its window, its use within it, and its lifetime tally. */
const TRACK = {
  photo: { at: 'lastPhotoAt', used: 'photoBurst', count: 'photoCount' },
  message: { at: 'lastMessageAt', used: 'messageBurst', count: 'messageCount' },
  album: { at: 'lastAlbumAt', used: 'albumBurst', count: 'albumCount' },
} as const

export type GuestAction = keyof typeof COOLDOWN

export type GuestGate =
  | { ok: true }
  | { ok: false; reason: 'blocked' }
  | { ok: false; reason: 'cooldown'; remaining: number }

export async function getGuest(guestId: string): Promise<Guest | null> {
  const snap = await adminDb.collection(COLLECTIONS.GUESTS).doc(guestId).get()
  return snap.exists ? (snap.data() as Guest) : null
}

/** Check whether a guest may perform an action right now. Does not mutate. */
export async function checkGuestGate(
  guestId: string,
  action: GuestAction,
  limits?: PhotoLimits
): Promise<GuestGate> {
  const guest = await getGuest(guestId)
  if (!guest) return { ok: true } // first time — nothing to block or throttle

  // Blocking holds whatever the limits say; turning limits off only lifts the
  // cooldown
  if (guest.blocked) return { ok: false, reason: 'blocked' }
  if (action !== 'message' && limits && (!limits.enabled || limits.windowSec === 0)) return { ok: true }

  const { windowSec, burst } = action !== 'message' && limits ? limits : COOLDOWN[action]
  const t = TRACK[action]
  const startedAt = guest[t.at]
  const used = guest[t.used] ?? 0
  if (!startedAt) return { ok: true }

  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000
  if (elapsed >= windowSec) return { ok: true } // window expired
  if (used < burst) return { ok: true } // still have burst allowance

  return { ok: false, reason: 'cooldown', remaining: Math.ceil(windowSec - elapsed) }
}

/**
 * Record a successful action: upserts the guest, bumps counters and advances
 * the cooldown window. Call this only after the action actually succeeded.
 */
export async function recordGuestAction(
  guestId: string,
  guestName: string,
  action: GuestAction,
  limits?: PhotoLimits
): Promise<void> {
  const ref = adminDb.collection(COLLECTIONS.GUESTS).doc(guestId)
  const now = new Date().toISOString()
  const { windowSec } = action !== 'message' && limits ? limits : COOLDOWN[action]
  const t = TRACK[action]

  // In a transaction: files in a batch upload side by side and complete within
  // milliseconds of each other. Read-then-write without one let three
  // completions each read "0 used" and each write "1", so a 3-photo batch was
  // recorded as one and the cooldown never engaged.
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existing = snap.exists ? (snap.data() as Guest) : null
    const startedAt = existing?.[t.at]
    const used = existing?.[t.used] ?? 0
    const windowExpired =
      !startedAt || (Date.now() - new Date(startedAt).getTime()) / 1000 >= windowSec

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {
      guestId,
      guestName,
      lastActiveAt: now,
      blocked: existing?.blocked ?? false,
      firstSeenAt: existing?.firstSeenAt ?? now,
      [t.count]: FieldValue.increment(1),
    }
    if (windowExpired) { patch[t.at] = now; patch[t.used] = 1 }
    else { patch[t.used] = used + 1 }

    tx.set(ref, patch, { merge: true })
  })
}

/** Human-readable rejection for the guest-facing API responses. */
/**
 * What the guest was trying to do, so the refusal names it. This once said
 * 上傳 for everything, and a guest refused a blessing or a 投影 was told to wait
 * before uploading — something they had not tried to do.
 */
export type GateAction = 'upload' | 'message' | 'project'

export function gateErrorMessage(gate: Exclude<GuestGate, { ok: true }>, action: GateAction): string {
  if (gate.reason === 'blocked') {
    return { upload: '目前暫停上傳，請洽工作人員', message: '目前暫停送出祝福，請洽工作人員', project: '目前暫停投影，請洽工作人員' }[action]
  }
  const s = gate.remaining
  return {
    upload: `請稍候 ${s} 秒後再上傳`,
    message: `請稍候 ${s} 秒後再送出祝福`,
    // 投影 spends the same allowance as uploading, so the wait usually follows
    // an upload; saying so tells the guest why the button is refusing
    project: `剛分享過照片，請稍候 ${s} 秒再投影`,
  }[action]
}
