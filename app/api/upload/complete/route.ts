import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { findFileByName, getDriveFileIfNamed, setDriveFilePublic, buildThumbnailUrl } from '@/lib/google-drive'
import { getSettings } from '@/lib/settings'
import { isAdminAuthenticated } from '@/lib/auth'
import { recordGuestAction } from '@/lib/guests'
import { photoLimits, albumLimits } from '@/lib/upload-limits'
import { Media, AlbumItem } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/upload/complete
 *
 * Called by the browser after it has uploaded a file directly to Google Drive.
 * The browser can read Drive's response (Drive answers with CORS headers for
 * the site — checked), so it sends the file id, which is confirmed by name.
 * Searching Drive by the exact fileName from /api/upload/init remains as the
 * fallback for a client that could not read it.
 *
 * Body (JSON):
 *   mediaId    string
 *   guestId    string
 *   guestName  string
 *   fileName   string   ← used to locate the file in Drive
 *   mimeType   string
 *   fileSize   number
 *   fileType   'photo' | 'video'
 */
export async function POST(req: NextRequest) {
  // Gating happened at /api/upload/init; by this point the bytes are already
  // in Drive, so we only need to know whether to advance the guest's cooldown.
  const admin = await isAdminAuthenticated(req)

  try {
    const body = await req.json()
    const { mediaId, guestId, guestName, fileName, mimeType, fileSize } = body
    const albumOnly = body.albumOnly === true
    // Decided here from the type, never taken from the client
    const fileType = String(mimeType || '').startsWith('video/') ? 'video' : 'photo'
    if (fileType === 'video' && !albumOnly) {
      return NextResponse.json({ success: false, error: '投影只接受照片' }, { status: 400 })
    }

    if (!mediaId || !guestId || !guestName || !fileName) {
      return NextResponse.json({ success: false, error: '缺少必要資訊' }, { status: 400 })
    }

    // Prefer the id the browser read from Drive, confirmed by name. Otherwise
    // search by the exact name — Drive's index can lag a moment behind the
    // upload, hence a few short retries.
    let googleDriveFileId: string | null =
      typeof body.googleDriveFileId === 'string' && (await getDriveFileIfNamed(body.googleDriveFileId, fileName))
        ? body.googleDriveFileId
        : null
    for (let attempt = 0; !googleDriveFileId && attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 700))
      googleDriveFileId = await findFileByName(fileName)
      if (googleDriveFileId) break
    }

    if (!googleDriveFileId) {
      console.error(`complete: file not found in Drive after retries — fileName=${fileName}`)
      return NextResponse.json(
        { success: false, error: '找不到已上傳的檔案，請重試' },
        { status: 404 }
      )
    }

    // Make the Drive file publicly readable
    const { webViewLink } = await setDriveFilePublic(googleDriveFileId)

    const settings = await getSettings()
    const now = new Date()

    if (albumOnly) {
      const item: AlbumItem = {
        id: mediaId,
        guestId,
        guestName,
        fileType,
        fileName,
        mimeType,
        fileSize,
        googleDriveFileId,
        googleDriveUrl: webViewLink,
        thumbnailUrl: buildThumbnailUrl(googleDriveFileId),
        uploadTime: now.toISOString(),
        status: 'active',
      }
      await adminDb.collection(COLLECTIONS.ALBUM).doc(mediaId).set(item)
      if (!admin) await recordGuestAction(guestId, guestName, 'album', albumLimits(settings))
      return NextResponse.json({ success: true, mediaId })
    }

    // Persist metadata to Firestore
    const media: Media = {
      id: mediaId,
      guestId,
      guestName,
      fileType,
      fileName,
      mimeType,
      fileSize,
      googleDriveFileId,
      googleDriveUrl: webViewLink,
      thumbnailUrl: buildThumbnailUrl(googleDriveFileId),
      uploadTime: now.toISOString(),
      status: 'active',
      approved: !settings.requireApproval,
      // New uploads always start queued; the display promotes them per rule Y
      displayState: 'pending',
      displayStateAt: now.toISOString(),
    }

    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).set(media)

    // Only a successful upload advances the cooldown window ("失敗不罰")
    if (!admin) {
      await recordGuestAction(guestId, guestName, 'photo', photoLimits(settings))
    }

    return NextResponse.json({ success: true, mediaId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/upload/complete error:', msg)
    return NextResponse.json({ success: false, error: `完成上傳失敗: ${msg}` }, { status: 500 })
  }
}
