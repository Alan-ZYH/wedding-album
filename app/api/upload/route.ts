import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { uploadFileToDrive, buildThumbnailUrl } from '@/lib/google-drive'
import { validateFile, sanitizeName, MAX_FILES } from '@/lib/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { getSettings } from '@/lib/settings'
import { isAdminAuthenticated } from '@/lib/auth'

export const dynamic = 'force-dynamic'
import { isGuestAuthenticated } from '@/lib/guest-auth'
import { Media } from '@/types'

export const maxDuration = 300 // 5 minutes for large video uploads

export async function POST(req: NextRequest) {
  // Auth check
  const admin = await isAdminAuthenticated(req)
  if (!admin && !isGuestAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權存取' }, { status: 401 })
  }

  // Rate limit check
  if (!checkRateLimit(req, parseInt(process.env.RATE_LIMIT_MAX || '10'))) {
    return NextResponse.json({ success: false, error: '上傳過於頻繁，請稍後再試' }, { status: 429 })
  }

  try {
    const formData = await req.formData()
    const guestId = formData.get('guestId') as string
    const guestNameRaw = formData.get('guestName') as string
    const files = formData.getAll('files') as File[]

    if (!guestId || !guestNameRaw) {
      return NextResponse.json({ success: false, error: '缺少賓客資訊' }, { status: 400 })
    }

    const guestName = sanitizeName(guestNameRaw)
    if (!guestName) {
      return NextResponse.json({ success: false, error: '名稱無效' }, { status: 400 })
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ success: false, error: '未選擇檔案' }, { status: 400 })
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { success: false, error: `單次最多上傳 ${MAX_FILES} 個檔案` },
        { status: 400 }
      )
    }

    const settings = await getSettings()

    const results: { success: boolean; mediaId?: string; error?: string }[] = []

    for (const file of files) {
      try {
        const validation = validateFile(file.type, file.size)
        if (!validation.valid) {
          results.push({ success: false, error: validation.error })
          continue
        }

        // Build filename: YYYYMMDD_HHMMSS_guestName_guestId_random.ext
        const now = new Date()
        const dateStr = now
          .toISOString()
          .replace(/[-:T]/g, '')
          .slice(0, 15)
          .replace(/(\d{8})(\d{6})/, '$1_$2')
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
        const random = uuidv4().slice(0, 8)
        const safeName = guestName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 20)
        const fileName = `${dateStr}_${safeName}_${guestId.slice(0, 8)}_${random}.${ext}`

        // Upload to Google Drive
        const buffer = Buffer.from(await file.arrayBuffer())
        const driveResult = await uploadFileToDrive(
          buffer,
          fileName,
          file.type,
          validation.fileType === 'video'
        )

        // Save to Firestore
        const mediaId = uuidv4()
        const media: Media = {
          id: mediaId,
          guestId,
          guestName,
          fileType: validation.fileType!,
          fileName,
          mimeType: file.type,
          fileSize: file.size,
          googleDriveFileId: driveResult.fileId,
          googleDriveUrl: driveResult.webViewLink,
          thumbnailUrl: buildThumbnailUrl(driveResult.fileId),
          uploadTime: now.toISOString(),
          status: 'active',
          approved: !settings.requireApproval,
        }

        await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).set(media)
        results.push({ success: true, mediaId })
      } catch (err) {
        console.error('File upload error:', err)
        results.push({ success: false, error: '上傳失敗，請重試' })
      }
    }

    const allFailed = results.every((r) => !r.success)
    return NextResponse.json({
      success: !allFailed,
      results,
    })
  } catch (err) {
    console.error('Upload route error:', err)
    return NextResponse.json({ success: false, error: '上傳失敗' }, { status: 500 })
  }
}
