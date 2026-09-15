import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { AlbumItem } from '@/types'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * PATCH /api/album/[id]  body: { guestId, status: 'deleted' }
 *
 * A guest removes something they kept for the couple; the admin may too.
 * Soft delete, like everything else here: the Drive file stays.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await req.json()
    const ref = adminDb.collection(COLLECTIONS.ALBUM).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return NextResponse.json({ success: false, error: '找不到檔案' }, { status: 404 })

    const item = snap.data() as AlbumItem
    const admin = await isAdminAuthenticated(req)
    if (!admin && (!body.guestId || body.guestId !== item.guestId)) {
      return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
    }
    if (body.status !== 'deleted') {
      return NextResponse.json({ success: false, error: '不支援的操作' }, { status: 400 })
    }
    await ref.update({ status: 'deleted' })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/album/[id] error:', err)
    return NextResponse.json({ success: false, error: '更新失敗' }, { status: 500 })
  }
}
