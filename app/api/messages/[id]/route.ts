import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { sanitizeText } from '@/lib/sanitize'
import { Message } from '@/types'
import { admitMessage, unpinMessage, LEAVE_ROTATION, PinLimitError, RotationFullError } from '@/lib/message-pool'

export const dynamic = 'force-dynamic'

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
        // Out of rotation too, or it would hold a slot nobody can see
        Object.assign(updates, { status: 'deleted', ...LEAVE_ROTATION })
      }
      await docRef.update(updates)
      return NextResponse.json({ success: true })
    }

    const now = new Date().toISOString()

    // ── Rotation actions: 置頂 / 取消置頂 / 投放 ─────────────────
    try {
      if (body.action === 'pin') {
        await admitMessage({ ref: docRef, as: 'pinned', extra: { status: 'active', updatedAt: now } })
        return NextResponse.json({ success: true })
      }
      if (body.action === 'unpin') {
        await unpinMessage(docRef)
        return NextResponse.json({ success: true })
      }
      if (body.action === 'play') {
        // Back into rotation as the newest — so the next blessings push it out
        // again in turn, exactly like a fresh one
        await admitMessage({ ref: docRef, as: 'playing', extra: { status: 'active', updatedAt: now } })
        return NextResponse.json({ success: true })
      }
    } catch (err) {
      if (err instanceof PinLimitError || err instanceof RotationFullError) {
        return NextResponse.json({ success: false, error: err.message }, { status: 409 })
      }
      throw err
    }

    const updates: Record<string, unknown> = { updatedAt: now }
    if (body.message !== undefined) {
      const clean = sanitizeText(body.message)
      if (!clean) return NextResponse.json({ success: false, error: '祝福內容無效' }, { status: 400 })
      updates.message = clean
    }
    if (body.status === 'hidden' || body.status === 'deleted') {
      Object.assign(updates, { status: body.status, ...LEAVE_ROTATION })
    }

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

    // Soft delete, like photos: it leaves the screen and the list, but the
    // blessing survives for the backup export — a hasty tap during the
    // reception should not erase what a guest wrote.
    await adminDb.collection(COLLECTIONS.MESSAGES).doc(id).update({
      status: 'deleted',
      updatedAt: new Date().toISOString(),
      ...LEAVE_ROTATION,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/messages/[id] error:', err)
    return NextResponse.json({ success: false, error: '刪除失敗' }, { status: 500 })
  }
}
