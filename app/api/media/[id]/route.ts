import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { deleteFileFromDrive } from '@/lib/google-drive'
import { Media, DisplayState } from '@/types'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const isAdmin = await isAdminAuthenticated(req)
    const body = await req.json()

    const docRef = adminDb.collection(COLLECTIONS.MEDIA).doc(id)
    const doc = await docRef.get()

    if (!doc.exists) {
      return NextResponse.json({ success: false, error: '找不到媒體' }, { status: 404 })
    }

    const media = doc.data() as Media

    if (!isAdmin) {
      const { guestId, status, displayError } = body

      // Allow display client to report a playback error (no auth needed)
      if (displayError === true && !guestId && !status) {
        await docRef.update({ displayError: true })
        return NextResponse.json({ success: true })
      }

      // Guest can only update their own media status (hidden or deleted)
      if (!guestId || media.guestId !== guestId) {
        return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
      }
      const allowedStatuses: string[] = ['hidden', 'deleted']
      if (!status || !allowedStatuses.includes(status)) {
        return NextResponse.json({ success: false, error: '無權限執行此操作' }, { status: 403 })
      }
      await docRef.update({ status })
      return NextResponse.json({ success: true })
    }

    const allowedFields = ['status', 'approved', 'displayError']
    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field]
    }

    // ── Carousel state transitions ──────────────────────────────
    const nextState = body.displayState as DisplayState | undefined
    if (nextState && ['pending', 'playing', 'pinned', 'masked'].includes(nextState)) {
      const now = new Date().toISOString()
      updates.displayState = nextState
      updates.displayStateAt = now
      if (nextState === 'pinned') updates.pinnedOrder = Date.now()

      // ▶️ means "cut the queue": the photo joins the carousel and every
      // screen jumps to it. If the pool is already full, the photo that has
      // been playing longest steps aside to make room.
      if (nextState === 'playing') {
        const settings = await getSettings()
        const size = settings.carouselSize ?? 50
        const [pinnedSnap, playingSnap] = await Promise.all([
          adminDb.collection(COLLECTIONS.MEDIA)
            .where('displayState', '==', 'pinned').get(),
          adminDb.collection(COLLECTIONS.MEDIA)
            .where('displayState', '==', 'playing').get(),
        ])
        const slots = Math.max(0, size - pinnedSnap.size)
        const others = playingSnap.docs.filter((d) => d.id !== id)
        if (others.length >= slots) {
          const oldest = others
            .sort((a, b) =>
              String(a.data().displayStateAt || '').localeCompare(String(b.data().displayStateAt || ''))
            )
            .slice(0, others.length - slots + 1)
          const batch = adminDb.batch()
          oldest.forEach((d) =>
            batch.update(d.ref, { displayState: 'masked', displayStateAt: now })
          )
          await batch.commit()
        }
        await adminDb.collection('display').doc('playback').set(
          { currentMediaId: id, jumpAt: now },
          { merge: true }
        )
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: '沒有可更新的欄位' }, { status: 400 })
    }

    await docRef.update(updates)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/media/[id] error:', err)
    return NextResponse.json({ success: false, error: '更新失敗' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const isAdmin = await isAdminAuthenticated(req)

    if (!isAdmin) {
      return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
    }

    const docRef = adminDb.collection(COLLECTIONS.MEDIA).doc(id)
    const doc = await docRef.get()

    if (!doc.exists) {
      return NextResponse.json({ success: false, error: '找不到媒體' }, { status: 404 })
    }

    const media = doc.data() as Media

    try {
      await deleteFileFromDrive(media.googleDriveFileId)
    } catch (err) {
      console.error('Google Drive delete error:', err)
    }

    await docRef.delete()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/media/[id] error:', err)
    return NextResponse.json({ success: false, error: '刪除失敗' }, { status: 500 })
  }
}
