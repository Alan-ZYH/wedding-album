import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { sanitizeName } from '@/lib/sanitize'
import { Guest, NameChange } from '@/types'
import { checkNames } from '@/lib/name-rules'

export const dynamic = 'force-dynamic'

/**
 * POST /api/guests/register — create or rename a guest.
 *
 * Body: { guestId, realName, guestName }
 *
 * Called when a guest first enters the album and every time they edit either
 * name. Guests cannot write Firestore directly (rules keep the `guests`
 * collection admin-only), and the couple needs the edits on record, so both
 * the upsert and the history live here.
 *
 * Counters and the blocked flag are never touched: a rename must not reset a
 * cooldown, and it must not lift a block.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const guestId = String(body.guestId || '').trim()
    const realName = sanitizeName(String(body.realName || ''))
    const guestName = sanitizeName(String(body.guestName || ''))

    if (!guestId || !realName || !guestName) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 })
    }

    // The form checks this too; a client is not a place to enforce anything
    const problem = checkNames(realName, guestName)
    if (problem) {
      return NextResponse.json({ success: false, error: problem }, { status: 400 })
    }

    const ref = adminDb.collection(COLLECTIONS.GUESTS).doc(guestId)
    const snap = await ref.get()
    const now = new Date().toISOString()

    if (!snap.exists) {
      await ref.set({
        guestId,
        realName,
        guestName,
        nameHistory: [],
        firstSeenAt: now,
        lastActiveAt: now,
        photoCount: 0,
        messageCount: 0,
        blocked: false,
      })
      return NextResponse.json({ success: true, created: true })
    }

    const existing = snap.data() as Guest
    const changes: NameChange[] = []
    if (existing.realName && existing.realName !== realName) {
      changes.push({ at: now, field: 'realName', from: existing.realName, to: realName })
    }
    if (existing.guestName && existing.guestName !== guestName) {
      changes.push({ at: now, field: 'guestName', from: existing.guestName, to: guestName })
    }

    await ref.set(
      {
        realName,
        guestName,
        lastActiveAt: now,
        // Cap the log so one guest fiddling with their name can't grow the
        // document without bound; the most recent edits are the useful ones.
        nameHistory: [...(existing.nameHistory ?? []), ...changes].slice(-50),
      },
      { merge: true }
    )

    return NextResponse.json({ success: true, changed: changes.length })
  } catch (err) {
    console.error('POST /api/guests/register error:', err)
    return NextResponse.json({ success: false, error: '無法儲存名稱' }, { status: 500 })
  }
}
