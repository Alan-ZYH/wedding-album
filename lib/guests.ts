import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, COLLECTIONS } from './firebase-admin'
import { Guest } from '@/types'

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
  photo: { windowSec: 30, burst: 3 },
  message: { windowSec: 30, burst: 1 },
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
  action: GuestAction
): Promise<GuestGate> {
  const guest = await getGuest(guestId)
  if (!guest) return { ok: true } // first time — nothing to block or throttle

  if (guest.blocked) return { ok: false, reason: 'blocked' }

  const { windowSec, burst } = COOLDOWN[action]
  const startedAt = action === 'photo' ? guest.lastPhotoAt : guest.lastMessageAt
  const used = (action === 'photo' ? guest.photoBurst : guest.messageBurst) ?? 0
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
  action: GuestAction
): Promise<void> {
  const ref = adminDb.collection(COLLECTIONS.GUESTS).doc(guestId)
  const now = new Date().toISOString()
  const { windowSec } = COOLDOWN[action]

  const existing = await getGuest(guestId)
  const startedAt = action === 'photo' ? existing?.lastPhotoAt : existing?.lastMessageAt
  const used = (action === 'photo' ? existing?.photoBurst : existing?.messageBurst) ?? 0
  const windowExpired =
    !startedAt || (Date.now() - new Date(startedAt).getTime()) / 1000 >= windowSec

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    guestId,
    guestName,
    lastActiveAt: now,
    blocked: existing?.blocked ?? false,
    firstSeenAt: existing?.firstSeenAt ?? now,
    [action === 'photo' ? 'photoCount' : 'messageCount']: FieldValue.increment(1),
  }
  if (action === 'photo') {
    if (windowExpired) { patch.lastPhotoAt = now; patch.photoBurst = 1 }
    else { patch.photoBurst = used + 1 }
  } else {
    if (windowExpired) { patch.lastMessageAt = now; patch.messageBurst = 1 }
    else { patch.messageBurst = used + 1 }
  }

  await ref.set(patch, { merge: true })
}

/** Human-readable rejection for the guest-facing API responses. */
export function gateErrorMessage(gate: Exclude<GuestGate, { ok: true }>): string {
  return gate.reason === 'blocked'
    ? '目前暫停上傳，請洽工作人員'
    : `請稍候 ${gate.remaining} 秒後再上傳`
}
