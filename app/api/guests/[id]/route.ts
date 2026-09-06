import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * PATCH /api/guests/[id]  body: { blocked: boolean }
 *
 * Blocking a guest also masks every photo they uploaded and hides every
 * blessing they posted — blocking is normally a reaction to bad content, so
 * the two actions belong together.
 *
 * Unblocking only restores upload permission; masked photos stay masked so
 * the admin stays in control of what goes back on screen.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }

  try {
    const { id } = await params
    const { blocked } = await req.json()
    if (typeof blocked !== 'boolean') {
      return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const guestRef = adminDb.collection(COLLECTIONS.GUESTS).doc(id)
    if (!(await guestRef.get()).exists) {
      return NextResponse.json({ success: false, error: '找不到此賓客' }, { status: 404 })
    }

    await guestRef.set(
      blocked ? { blocked: true, blockedAt: now } : { blocked: false },
      { merge: true }
    )

    let maskedPhotos = 0
    let hiddenMessages = 0

    if (blocked) {
      const [mediaSnap, msgSnap] = await Promise.all([
        adminDb.collection(COLLECTIONS.MEDIA).where('guestId', '==', id).get(),
        adminDb.collection(COLLECTIONS.MESSAGES).where('guestId', '==', id).get(),
      ])

      // Firestore batches cap at 500 writes
      let batch = adminDb.batch()
      let pending = 0
      const flush = async () => {
        if (pending) { await batch.commit(); batch = adminDb.batch(); pending = 0 }
      }

      for (const doc of mediaSnap.docs) {
        if (doc.data().displayState === 'masked') continue
        batch.update(doc.ref, { displayState: 'masked', displayStateAt: now })
        maskedPhotos++
        if (++pending >= 400) await flush()
      }
      for (const doc of msgSnap.docs) {
        if (doc.data().status !== 'active') continue
        batch.update(doc.ref, { status: 'hidden' })
        hiddenMessages++
        if (++pending >= 400) await flush()
      }
      await flush()
    }

    return NextResponse.json({ success: true, maskedPhotos, hiddenMessages })
  } catch (err) {
    console.error('PATCH /api/guests/[id] error:', err)
    return NextResponse.json({ success: false, error: '更新失敗' }, { status: 500 })
  }
}
