import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { PlaybackState } from '@/types'
import { getSettings } from '@/lib/settings'
import { promoteFlown } from '@/lib/message-pool'

export const dynamic = 'force-dynamic'

const PLAYBACK_DOC = adminDb.collection('display').doc('playback')
/** A controller is considered dead after this long without a heartbeat. */
const STALE_MS = 30_000

/**
 * GET — current playback position.
 *
 * Follower screens read this instead of the Firestore document directly:
 * `display` is not exposed to the browser SDK, so a client-side listener fails
 * silently and every follower stalls on the first slide.
 */
export async function GET() {
  try {
    const snap = await PLAYBACK_DOC.get()
    return NextResponse.json({
      success: true,
      data: snap.exists ? (snap.data() as PlaybackState) : null,
    })
  } catch (err) {
    console.error('GET /api/display error:', err)
    return NextResponse.json({ success: false, error: 'playback read failed' }, { status: 500 })
  }
}

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
      // Take over when there is no controller, the incumbent went quiet, or the
      // incumbent is in the background while this screen is in view.
      //
      // A background tab still sends its heartbeat, slowly, but the browser
      // throttles the timer that launches blessings to about once a minute. As
      // controller it held on while the queue barely moved — measured: 120
      // blessings queued, none flown in 40 seconds, with a visible screen
      // flying them fine but not allowed to report them.
      // Older screens send no `visible`; they count as in view.
      const hidden = body.visible === false
      const isController = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(PLAYBACK_DOC)
        const cur = snap.data() as PlaybackState | undefined
        if (cur?.controllerId === clientId) {
          if (!!cur?.controllerHidden !== hidden) {
            tx.set(PLAYBACK_DOC, { controllerHidden: hidden }, { merge: true })
          }
          return true
        }
        const stale =
          !cur?.controllerId ||
          Date.now() - new Date(cur.heartbeatAt || 0).getTime() > STALE_MS
        const takeOverFromBackground = !!cur?.controllerHidden && !hidden
        if (!stale && !takeOverFromBackground) return false
        tx.set(
          PLAYBACK_DOC,
          { controllerId: clientId, heartbeatAt: new Date().toISOString(), controllerHidden: hidden },
          { merge: true }
        )
        return true
      })
      return NextResponse.json({ success: true, isController })
    }

    // A queued blessing has flown on the controlling screen. Only that screen's
    // report counts: followers fly the same queue, and letting every screen
    // report would be a race to promote with no gain.
    if (action === 'messageFlown') {
      const { messageId } = body
      if (!messageId) {
        return NextResponse.json({ success: false, error: 'messageId required' }, { status: 400 })
      }
      const cur = (await PLAYBACK_DOC.get()).data() as PlaybackState | undefined
      if (cur?.controllerId !== clientId) {
        return NextResponse.json({ success: true, result: 'not-controller' })
      }
      const result = await promoteFlown(adminDb.collection(COLLECTIONS.MESSAGES).doc(String(messageId)))
      return NextResponse.json({ success: true, result })
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
      const requested: string[] =
        rotate?.promoteIds ?? (rotate?.promoteId ? [rotate.promoteId] : [])
      const media = adminDb.collection(COLLECTIONS.MEDIA)

      const heartbeat = { controllerId: clientId, heartbeatAt: now, currentMediaId: currentMediaId ?? '' }

      // Most advances only move the slide on. They must stay a single write:
      // one runs every few seconds for the whole reception, and anything that
      // reads per call would eat the daily Firestore read allowance.
      if (requested.length === 0) {
        await PLAYBACK_DOC.set(heartbeat, { merge: true })
        return NextResponse.json({ success: true, isController: true, promoted: 0 })
      }

      // The screen asks for promotions based on its own Firestore snapshot,
      // and that snapshot lags behind the writes. With hundreds of photos
      // arriving within a minute it asked for slots that were already taken,
      // and because every write here was taken on trust the pool settled above
      // its limit — photos marked 播放 that the screen would never draw.
      //
      // So the count is made here, in a transaction, against what is actually
      // stored; the request only says which photos the screen would like next.
      // A count aggregation costs about one read however large the pool is.
      const { carouselSize = 50 } = await getSettings()
      const promoted = await adminDb.runTransaction(async (tx) => {
        const counted = await tx.get(
          media.where('displayState', 'in', ['pinned', 'playing']).count()
        )
        let occupied = counted.data().count

        const played = rotate?.playedId ? await tx.get(media.doc(rotate.playedId)) : null
        const candidates = await Promise.all(
          requested.slice(0, 100).map((id) => tx.get(media.doc(id)))
        )

        // Rule Y: the photo that just played steps aside — but only one that
        // is really in 播放, never a pinned photo or one already gone.
        if (played?.exists && played.data()?.displayState === 'playing') {
          tx.update(played.ref, { displayState: 'masked', displayStateAt: now, maskedBy: 'rotation' })
          occupied -= 1
        }

        let count = 0
        for (const doc of candidates) {
          if (occupied >= carouselSize) break
          const d = doc.data()
          // An admin may have masked, pinned or deleted it since the screen
          // last looked; only a photo still queued and visible may enter.
          if (!doc.exists || d?.displayState !== 'pending' || d?.status !== 'active') continue
          tx.update(doc.ref, { displayState: 'playing', displayStateAt: now })
          occupied += 1
          count += 1
        }

        tx.set(PLAYBACK_DOC, heartbeat, { merge: true })
        return count
      })

      return NextResponse.json({ success: true, isController: true, promoted })
    }

    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 })
  } catch (err) {
    console.error('POST /api/display error:', err)
    return NextResponse.json({ success: false, error: 'display sync failed' }, { status: 500 })
  }
}
