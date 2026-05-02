import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { deleteFileFromDrive } from '@/lib/google-drive'
import { Media } from '@/types'

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
