import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { findFileByName, setDriveFilePublic, buildThumbnailUrl } from '@/lib/google-drive'
import { getSettings } from '@/lib/settings'
import { isAdminAuthenticated } from '@/lib/auth'
import { recordGuestAction } from '@/lib/guests'
import { Media } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/upload/complete
 *
 * Called by the browser after it has uploaded a file directly to Google Drive.
 * Because CORS prevents the browser from reading the Drive upload response,
 * we don't receive the fileId from the client — instead we search Drive by
 * the exact fileName generated in /api/upload/init.
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
    const { mediaId, guestId, guestName, fileName, mimeType, fileSize, fileType } = body

    if (!mediaId || !guestId || !guestName || !fileName) {
      return NextResponse.json({ success: false, error: '缺少必要資訊' }, { status: 400 })
    }

    // Find the file in Drive by its exact name.
    // Keep total retry time well under Vercel Hobby's 10s limit:
    // 4 attempts with 700ms gaps ≈ 2.1s sleep + query time.
    let googleDriveFileId: string | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
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

    // Load approval settings
    const settings = await getSettings()

    // Persist metadata to Firestore
    const now = new Date()
    const media: Media = {
      id: mediaId,
      guestId,
      guestName,
      fileType: fileType ?? 'photo',
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
      await recordGuestAction(guestId, guestName, 'photo')
    }

    return NextResponse.json({ success: true, mediaId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/upload/complete error:', msg)
    return NextResponse.json({ success: false, error: `完成上傳失敗: ${msg}` }, { status: 500 })
  }
}
