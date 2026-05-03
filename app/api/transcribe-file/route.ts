/**
 * POST /api/transcribe-file
 *
 * Receives the original video file directly from the browser (multipart/form-data)
 * and sends it straight to Groq / OpenAI Whisper.
 *
 * Why this route exists:
 *   The existing /api/media/[id]/transcribe must re-download the video from
 *   Google Drive, which costs 3–5 s on Vercel before Whisper even starts.
 *   The browser already has the original file in memory right after upload, so
 *   we can send it here and skip the Drive round-trip entirely.
 *
 * Time budget on Vercel Hobby (10 s limit):
 *   - Browser → Vercel transfer (client LAN → CDN): ~0.5–2 s
 *   - Groq whisper-large-v3-turbo inference:         ~0.2–0.5 s
 *   - Firestore write:                               ~0.2 s
 *   Total:                                           ~1–3 s  ✅
 *
 * Body (multipart/form-data):
 *   file      File     — original video file from the browser
 *   mediaId   string   — Firestore document id
 *   fileName  string   — original file name (for extension detection)
 *   mimeType  string   — file MIME type
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI, { toFile } from 'openai'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { isGuestAuthenticated } from '@/lib/guest-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Whisper format remapping (.mov is not accepted — same container as mp4)
function toWhisperExt(ext: string): string {
  if (ext === 'mov') return 'mp4'
  const ok = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']
  return ok.includes(ext) ? ext : 'mp4'
}
function toWhisperMime(mime: string): string {
  if (mime === 'video/quicktime') return 'video/mp4'
  return mime || 'video/mp4'
}

const SAFE_TIMEOUT_MS = 8_500

export async function POST(req: NextRequest) {
  const isAdmin = await isAdminAuthenticated(req)
  if (!isAdmin && !isGuestAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權' }, { status: 401 })
  }

  const groqKey   = process.env.GROQ_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!groqKey && !openaiKey) {
    return NextResponse.json({ success: false, error: '未設定 GROQ_API_KEY 或 OPENAI_API_KEY' }, { status: 500 })
  }

  let mediaId = ''
  try {
    const form     = await req.formData()
    const file     = form.get('file')     as File   | null
    mediaId        = (form.get('mediaId')  as string) ?? ''
    const fileName = (form.get('fileName') as string) ?? ''
    const mimeType = (form.get('mimeType') as string) ?? ''

    if (!file || !mediaId) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 })
    }

    const docRef = adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId)

    // Fire-and-forget status reset so the UI shows "字幕生成中" immediately
    docRef.update({ transcriptStatus: 'pending', transcript: '', transcriptNote: '' }).catch(() => {})

    const useGroq  = !!groqKey
    const client   = new OpenAI({
      apiKey: useGroq ? groqKey! : openaiKey!,
      ...(useGroq ? { baseURL: 'https://api.groq.com/openai/v1' } : {}),
    })
    const model    = useGroq ? 'whisper-large-v3-turbo' : 'whisper-1'
    const rawExt   = (fileName.split('.').pop() ?? 'mp4').toLowerCase()
    const wExt     = toWhisperExt(rawExt)
    const wMime    = toWhisperMime(mimeType)

    console.log(`[transcribe-file] mediaId=${mediaId} size=${file.size} provider=${useGroq ? 'groq' : 'openai'} ext=${rawExt}→${wExt}`)

    const controller = new AbortController()
    let timedOut = false

    const timeoutHandle = setTimeout(async () => {
      timedOut = true
      controller.abort()
      console.warn(`[transcribe-file] timeout at ${SAFE_TIMEOUT_MS} ms`)
      await docRef.update({
        transcriptStatus: 'error',
        transcriptNote: '字幕生成超時，請點選重試',
      }).catch(() => {})
    }, SAFE_TIMEOUT_MS)

    try {
      const result = await client.audio.transcriptions.create(
        {
          // The File object from FormData works directly with the OpenAI SDK
          file: await toFile(file, `audio.${wExt}`, { type: wMime }),
          model,
          language: 'zh',
        },
        { signal: controller.signal }
      )

      if (!timedOut) {
        clearTimeout(timeoutHandle)
        const transcript = result.text?.trim() ?? ''
        console.log(`[transcribe-file] done: "${transcript}"`)
        await docRef.update({ transcript, transcriptStatus: 'done', transcriptNote: '' })
      }
    } catch (err) {
      if (!timedOut) clearTimeout(timeoutHandle)
      if (timedOut) return NextResponse.json({ success: false, error: 'timeout' })
      if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)) {
        return NextResponse.json({ success: false, error: 'aborted' })
      }
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[transcribe-file] error:', msg)
      await docRef.update({
        transcriptStatus: 'error',
        transcriptNote: msg.slice(0, 300),
      }).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[transcribe-file] outer error:', msg)
    if (mediaId) {
      await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId)
        .update({ transcriptStatus: 'error', transcriptNote: msg.slice(0, 300) })
        .catch(() => {})
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
