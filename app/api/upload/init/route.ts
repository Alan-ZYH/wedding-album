import { NextRequest, NextResponse } from 'next/server'
import { getSettings } from '@/lib/settings'
import { photoLimits, albumLimits, initRequestsPerMinute } from '@/lib/upload-limits'
import { photosOpen, albumOpen, CLOSED_MESSAGE } from '@/lib/guest-access'
import { v4 as uuidv4 } from 'uuid'
import { createResumableUploadSession } from '@/lib/google-drive'
import { validateFile, sanitizeName } from '@/lib/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { isAdminAuthenticated } from '@/lib/auth'
import { checkGuestGate, gateErrorMessage } from '@/lib/guests'

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
  // The guest page is open to anyone with the link; the gate below is what
  // stops blocked guests and enforces the upload cooldown.
  const admin = await isAdminAuthenticated(req)

  try {
    const body = await req.json()
    const { guestId, guestNameRaw, mimeType, fileSize, originalName } = body
    // 存入新人相簿：kept for the couple, never projected, videos allowed
    const albumOnly = body.albumOnly === true

    if (!guestId || !guestNameRaw) {
      return NextResponse.json({ success: false, error: '缺少賓客資訊' }, { status: 400 })
    }

    // The admin's switches and limits, read per request so a change in 設定
    // applies to the very next photo
    const settings = await getSettings()
    const limits = albumOnly ? albumLimits(settings) : photoLimits(settings)

    // Closed to guests: the page shows the same message, but a page loaded
    // before the switch — or a direct request — is refused here all the same
    if (!admin && !(albumOnly ? albumOpen(settings) : photosOpen(settings))) {
      return NextResponse.json({ success: false, error: CLOSED_MESSAGE, reason: 'closed' }, { status: 403 })
    }

    // Rate limit keyed by ip+guestId so guests on the same venue WiFi
    // don't consume each other's quota. Derived from the limits so it can
    // never be stricter than what 設定 allows.
    if (!checkRateLimit(req, initRequestsPerMinute(limits), guestId)) {
      return NextResponse.json({ success: false, error: '上傳過於頻繁，請稍後再試' }, { status: 429 })
    }

    // Block list + 30s cooldown (admins bypass both)
    if (!admin) {
      const gate = await checkGuestGate(guestId, albumOnly ? 'album' : 'photo', limits)
      if (!gate.ok) {
        return NextResponse.json(
          {
            success: false,
            error: gateErrorMessage(gate),
            reason: gate.reason,
            remaining: gate.reason === 'cooldown' ? gate.remaining : undefined,
          },
          { status: gate.reason === 'blocked' ? 403 : 429 }
        )
      }
    }

    const guestName = sanitizeName(guestNameRaw)
    if (!guestName) {
      return NextResponse.json({ success: false, error: '名稱無效' }, { status: 400 })
    }

    const validation = validateFile(mimeType || '', fileSize || 0, albumOnly ? 'album' : 'projection')
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
    // Forward the browser's origin only when it is this site — the session is
    // what grants that origin CORS access to the upload response
    const origin = req.headers.get('origin')
    const sameSite = origin && (() => { try { return new URL(origin).host === req.headers.get('host') } catch { return false } })()
    const uploadUrl = await createResumableUploadSession(fileName, mimeType, fileSize, isVideo, sameSite ? origin : undefined)
    const mediaId = uuidv4()

    return NextResponse.json({
      success: true,
      uploadUrl,
      mediaId,
      fileName,
      fileType: validation.fileType, // 'photo' | 'video'
      albumOnly,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/upload/init error:', msg)
    // Return the raw error message so we can diagnose from the browser
    return NextResponse.json({ success: false, error: `初始化上傳失敗: ${msg}` }, { status: 500 })
  }
}
