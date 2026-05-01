import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { sanitizeText } from '@/lib/sanitize'
import { Message } from '@/types'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const isAdmin = await isAdminAuthenticated(req)
    const body = await req.json()

    const docRef = adminDb.collection(COLLECTIONS.MESSAGES).doc(id)
    const doc = await docRef.get()

    if (!doc.exists) {
      return NextResponse.json({ success: false, error: '找不到祝福' }, { status: 404 })
    }

    const msg = doc.data() as Message

    if (!isAdmin) {
      if (!body.guestId || msg.guestId !== body.guestId) {
        return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
      }
      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      }
      if (body.message !== undefined) {
        const clean = sanitizeText(body.message)
        if (!clean) return NextResponse.json({ success: false, error: '祝福內容無效' }, { status: 400 })
        updates.message = clean
      }
      if (body.status === 'deleted') {
        updates.status = 'deleted'
      }
      await docRef.update(updates)
      return NextResponse.json({ success: true })
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (body.message !== undefined) updates.message = sanitizeText(body.message)
    if (body.status !== undefined) updates.status = body.status
    if (body.priority !== undefined) updates.priority = body.priority

    await docRef.update(updates)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/messages/[id] error:', err)
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

    await adminDb.collection(COLLECTIONS.MESSAGES).doc(id).delete()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/messages/[id] error:', err)
    return NextResponse.json({ success: false, error: '刪除失敗' }, { status: 500 })
  }
}
