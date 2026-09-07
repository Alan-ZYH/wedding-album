import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { ensureFolders } from '@/lib/google-drive'

export const dynamic = 'force-dynamic'

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`

/**
 * GET /api/admin/drive-links — where the album actually lives in Drive.
 *
 * The ids come from the environment, never from the source: this repo is
 * public. Admin-only, since a folder id is the whole address of the album.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }
  try {
    const folders = await ensureFolders()
    const backupId = process.env.BACKUP_FOLDER_ID
    return NextResponse.json({
      success: true,
      data: {
        photos: folderUrl(folders.photos),
        videos: folderUrl(folders.videos),
        backup: backupId ? folderUrl(backupId) : null,
      },
    })
  } catch (err) {
    console.error('GET /api/admin/drive-links error:', err)
    return NextResponse.json({ success: false, error: '無法取得雲端連結' }, { status: 500 })
  }
}
