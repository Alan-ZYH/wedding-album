import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { setDriveFilePublic, buildThumbnailUrl } from '@/lib/google-drive'
import { getSettings } from '@/lib/settings'
import { isAdminAuthenticated } from '@/lib/auth'
import { isGuestAuthenticated } from '@/lib/guest-auth'
import { Media } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload/complete
 *
 * Called by the browser after it has successfully uploaded a file directly
 * to Google Drive.  This route:
 *   1. Makes the Drive file publicly readable.
 *   2. Saves the media metadata to Firestore.
 *
 * Body (JSON):
 *   mediaId             string
 *   googleDriveFileId   string
 *   guestId             string
 *   guestName           string
 *   fileName            string
 *   mimeType            string
 *   fileSize            number
 *   fileType            'photo' | 'video'
 */
export async function POST(req: NextRequest) {
  // Auth check
  const admin = await isAdminAuthenticated(req)
  if (!admin && !isGuestAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權存取' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const {
      mediaId,
      googleDriveFileId,
      guestId,
      guestName,
      fileName,
      mimeType,
      fileSize,
      fileType,
    } = body

    if (!mediaId || !googleDriveFileId || !guestId || !guestName || !fileName) {
      return NextResponse.json({ success: false, error: '缺少必要資訊' }, { status: 400 })
    }

    // Make the Drive file publicly readable and get its webViewLink
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
    }

    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).set(media)

    return NextResponse.json({ success: true, mediaId })
  } catch (err) {
    console.error('POST /api/upload/complete error:', err)
    return NextResponse.json({ success: false, error: '完成上傳失敗' }, { status: 500 })
  }
}
