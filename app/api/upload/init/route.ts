import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createResumableUploadSession } from '@/lib/google-drive'
import { validateFile, sanitizeName } from '@/lib/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { isAdminAuthenticated } from '@/lib/auth'
import { isGuestAuthenticated } from '@/lib/guest-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload/init
 *
 * Creates a Google Drive resumable upload session and returns the
 * session URL so the browser can upload the file directly to Google Drive,
 * bypassing Vercel's 4.5 MB request-body limit.
 *
 * Body (JSON):
 *   guestId        string
 *   guestNameRaw   string
 *   mimeType       string
 *   fileSize       number  (bytes)
 *   originalName   string  (original file name — used for extension only)
 */
export async function POST(req: NextRequest) {
  // Auth check
  const admin = await isAdminAuthenticated(req)
  if (!admin && !isGuestAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權存取' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { guestId, guestNameRaw, mimeType, fileSize, originalName } = body

    if (!guestId || !guestNameRaw) {
      return NextResponse.json({ success: false, error: '缺少賓客資訊' }, { status: 400 })
    }

    // Rate limit keyed by ip+guestId so guests on the same venue WiFi
    // don't consume each other's quota
    if (!checkRateLimit(req, parseInt(process.env.RATE_LIMIT_MAX || '10'), guestId)) {
      return NextResponse.json({ success: false, error: '上傳過於頻繁，請稍後再試' }, { status: 429 })
    }

    const guestName = sanitizeName(guestNameRaw)
    if (!guestName) {
      return NextResponse.json({ success: false, error: '名稱無效' }, { status: 400 })
    }

    const validation = validateFile(mimeType || '', fileSize || 0)
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }

    // Build a safe filename: guestName_YYYYMMDD_HHMMSS_random.ext
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateOnly = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    const timeOnly = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const ext = (originalName as string | undefined)?.split('.').pop()?.toLowerCase() || 'bin'
    const random = uuidv4().slice(0, 6)
    const safeName = guestName.replace(/[^a-zA-Z0-9一-鿿]/g, '').slice(0, 20)
    const fileName = `${safeName}_${dateOnly}_${timeOnly}_${random}.${ext}`

    const isVideo = validation.fileType === 'video'
    const uploadUrl = await createResumableUploadSession(fileName, mimeType, fileSize, isVideo)
    const mediaId = uuidv4()

    return NextResponse.json({
      success: true,
      uploadUrl,
      mediaId,
      fileName,
      fileType: validation.fileType, // 'photo' | 'video'
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/upload/init error:', msg)
    // Return the raw error message so we can diagnose from the browser
    return NextResponse.json({ success: false, error: `初始化上傳失敗: ${msg}` }, { status: 500 })
  }
}
