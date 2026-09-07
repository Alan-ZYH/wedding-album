import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { PlaybackState } from '@/types'

export const dynamic = 'force-dynamic'

const PLAYBACK_DOC = adminDb.collection('display').doc('playback')
/** A controller is considered dead after this long without a heartbeat. */
const STALE_MS = 30_000

/**
 * Display coordination endpoint. The display page is public by design, so
 * these operations are deliberately low-stakes: they only move photos between
 * carousel states and record which screen is driving playback.
 *
 * POST body:
 *   { action: 'claim',   clientId }
 *   { action: 'advance', clientId, currentMediaId,
 *     rotate?: { playedId?, promoteId?, promoteIds? } }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, clientId } = body
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'clientId required' }, { status: 400 })
    }

    if (action === 'claim') {
      // Take over only when there is no controller or the incumbent went quiet.
      const isController = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(PLAYBACK_DOC)
        const cur = snap.data() as PlaybackState | undefined
        const stale =
          !cur?.controllerId ||
          Date.now() - new Date(cur.heartbeatAt || 0).getTime() > STALE_MS
        if (cur?.controllerId === clientId) return true
        if (!stale) return false
        tx.set(
          PLAYBACK_DOC,
          { controllerId: clientId, heartbeatAt: new Date().toISOString() },
          { merge: true }
        )
        return true
      })
      return NextResponse.json({ success: true, isController })
    }

    if (action === 'advance') {
      const { currentMediaId, rotate } = body
      const snap = await PLAYBACK_DOC.get()
      const cur = snap.data() as PlaybackState | undefined
      if (cur?.controllerId && cur.controllerId !== clientId) {
        // Another screen is driving — ignore this write silently.
        return NextResponse.json({ success: true, isController: false })
      }

      const now = new Date().toISOString()
      const batch = adminDb.batch()
      batch.set(
        PLAYBACK_DOC,
        { controllerId: clientId, heartbeatAt: now, currentMediaId: currentMediaId ?? '' },
        { merge: true }
      )

      // Rule Y: the photo that just played steps aside for the next in the
      // queue. playedId is optional — omitting it promotes into free slots
      // without evicting anything, which is how a pool below capacity grows.
      // promoteIds fills every free slot in one write rather than one per
      // slide, so a pool starting from empty does not take minutes to fill.
      const promote: string[] = rotate?.promoteIds ?? (rotate?.promoteId ? [rotate.promoteId] : [])
      if (promote.length) {
        if (rotate.playedId) {
          batch.update(adminDb.collection(COLLECTIONS.MEDIA).doc(rotate.playedId), {
            displayState: 'masked',
            displayStateAt: now,
          })
        }
        // Firestore batches cap at 500 writes; carouselSize maxes out at 100
        for (const id of promote.slice(0, 200)) {
          batch.update(adminDb.collection(COLLECTIONS.MEDIA).doc(id), {
            displayState: 'playing',
            displayStateAt: now,
          })
        }
      }

      await batch.commit()
      return NextResponse.json({ success: true, isController: true })
    }

    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 })
  } catch (err) {
    console.error('POST /api/display error:', err)
    return NextResponse.json({ success: false, error: 'display sync failed' }, { status: 500 })
  }
}
