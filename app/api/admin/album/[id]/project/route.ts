import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { moveAlbumToProjection } from '@/lib/album-move'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/album/[id]/project — 加入投影.
 *
 * Moves a kept photo into the projection: it becomes an ordinary queued photo
 * in 媒體管理, keeping its id and Drive file, and leaves the album collection
 * in the same transaction so it can never be in both. Photos only; the screen
 * does not play video.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }
  try {
    const { id } = await params
    const settings = await getSettings()
    const result = await moveAlbumToProjection(id, settings)

    if (result === 'missing') return NextResponse.json({ success: false, error: '找不到這個檔案' }, { status: 404 })
    if (result === 'video') return NextResponse.json({ success: false, error: '影片無法投影，大螢幕只播放照片' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/admin/album/[id]/project error:', err)
    return NextResponse.json({ success: false, error: '加入投影失敗' }, { status: 500 })
  }
}
