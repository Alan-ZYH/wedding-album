/**
 * lib/transcribe.ts
 *
 * Streams a video from Google Drive directly to a Whisper-compatible API.
 *
 * Provider selection (checked at runtime):
 *   1. GROQ_API_KEY is set  → Groq (whisper-large-v3-turbo, ~10–20× faster inference)
 *   2. OPENAI_API_KEY is set → OpenAI (whisper-1)
 *
 * Why Groq?  OpenAI Whisper inference takes ~3–5 s; Groq takes ~0.2–0.5 s.
 * Combined with Drive streaming this brings the total well under Vercel
 * Hobby's 10-second limit.  Groq's API is OpenAI-compatible, so no extra
 * SDK is needed — we just point the OpenAI client at Groq's base URL.
 *
 * Timeout guard:
 *   An AbortController fires at SAFE_TIMEOUT_MS (8.5 s) to cancel the
 *   in-flight request and write transcriptStatus:'error' to Firestore
 *   before Vercel kills the process at 10 s.
 */

import OpenAI, { toFile } from 'openai'
import { getDriveFileStream } from './google-drive'
import { adminDb, COLLECTIONS } from './firebase-admin'

// .mov (video/quicktime) is NOT in Whisper's accepted list — remap to mp4
function toWhisperExt(ext: string): string {
  if (ext === 'mov') return 'mp4'
  const supported = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']
  return supported.includes(ext) ? ext : 'mp4'
}
function toWhisperMime(mime: string): string {
  if (mime === 'video/quicktime') return 'video/mp4'
  return mime || 'video/mp4'
}

const WHISPER_MAX_BYTES = 24 * 1024 * 1024 // 24 MB hard cap

// Abort at 8.5 s to leave 1.5 s buffer before Vercel's 10-second kill
const SAFE_TIMEOUT_MS = 8_500

export async function transcribeVideo(
  mediaId: string,
  fileId: string,
  fileName: string,
  mimeType: string,
  /** Pass the already-known file size to skip an extra Drive API call */
  knownFileSize?: number
): Promise<void> {
  const groqKey   = process.env.GROQ_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  if (!groqKey && !openaiKey) {
    console.warn('[transcribe] No API key set (GROQ_API_KEY or OPENAI_API_KEY) — skipping')
    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
      transcriptStatus: 'error',
      transcriptNote: '未設定 GROQ_API_KEY 或 OPENAI_API_KEY',
    }).catch(() => {})
    return
  }

  // Determine provider
  const useGroq = !!groqKey
  const apiKey  = useGroq ? groqKey! : openaiKey!
  const model   = useGroq ? 'whisper-large-v3-turbo' : 'whisper-1'
  const baseURL = useGroq ? 'https://api.groq.com/openai/v1' : undefined
  console.log(`[transcribe] provider=${useGroq ? 'groq' : 'openai'} model=${model}`)

  const docRef = adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId)
  const controller = new AbortController()
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  // ── Safety timeout ──────────────────────────────────────────────────────
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(async () => {
      timedOut = true
      controller.abort()
      console.warn(`[transcribe] hard timeout at ${SAFE_TIMEOUT_MS} ms — mediaId=${mediaId}`)
      await docRef.update({
        transcriptStatus: 'error',
        transcriptNote: '字幕生成超時，請點選重試',
      }).catch(() => {})
      resolve()
    }, SAFE_TIMEOUT_MS)
  })

  // ── Main transcription work ─────────────────────────────────────────────
  const transcribePromise = (async () => {
    try {
      console.log(`[transcribe] start — mediaId=${mediaId} fileId=${fileId}`)

      // Use the caller-supplied size if available (saves a Drive metadata call)
      const fileSize = knownFileSize ?? 0
      if (fileSize > WHISPER_MAX_BYTES) {
        console.warn(`[transcribe] file too large (${fileSize} bytes) — skipping`)
        if (!timedOut) {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          await docRef.update({
            transcript: '',
            transcriptStatus: 'done',
            transcriptNote: '影片檔案過大（超過 24 MB），無法自動生成字幕',
          })
        }
        return
      }

      const rawExt    = fileName.split('.').pop()?.toLowerCase() || 'mp4'
      const whisperExt  = toWhisperExt(rawExt)
      const whisperMime = toWhisperMime(mimeType)
      console.log(`[transcribe] ext .${rawExt}→.${whisperExt}, mime ${mimeType}→${whisperMime}`)

      // Stream Drive file → Whisper (no intermediate buffering to disk)
      const stream = await getDriveFileStream(fileId)

      const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })

      const result = await client.audio.transcriptions.create(
        {
          file: await toFile(
            stream as unknown as AsyncIterable<Uint8Array>,
            `audio.${whisperExt}`,
            { type: whisperMime }
          ),
          model,
          language: 'zh',
        },
        { signal: controller.signal }
      )

      if (!timedOut) {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        const transcript = result.text?.trim() ?? ''
        console.log(`[transcribe] done: "${transcript}"`)
        await docRef.update({ transcript, transcriptStatus: 'done', transcriptNote: '' })
      }
    } catch (err) {
      if (timedOut) return
      if (timeoutHandle) clearTimeout(timeoutHandle)

      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)) return

      console.error('[transcribe] error:', msg)
      await docRef.update({
        transcriptStatus: 'error',
        transcriptNote: msg.slice(0, 300),
      }).catch(() => {})
    }
  })()

  await Promise.race([transcribePromise, timeoutPromise])
}
