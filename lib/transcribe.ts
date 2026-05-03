/**
 * lib/transcribe.ts
 *
 * Streams a video from Google Drive directly to OpenAI Whisper.
 *
 * Vercel Hobby caps serverless functions at 10 s.  We race against an
 * AbortController-based timeout at 8.5 s so that — even if Whisper doesn't
 * finish in time — we always write a terminal status ('error') to Firestore
 * before the process is killed.  Without this guard the status stays
 * 'pending' forever.
 */

import OpenAI, { toFile } from 'openai'
import { getDriveFileSize, getDriveFileStream } from './google-drive'
import { adminDb, COLLECTIONS } from './firebase-admin'

// Whisper supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm
// .mov (video/quicktime) is NOT listed — remap to mp4 (same QuickTime container)
function toWhisperExt(ext: string): string {
  if (ext === 'mov') return 'mp4'
  const supported = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']
  return supported.includes(ext) ? ext : 'mp4'
}

function toWhisperMime(mime: string): string {
  if (mime === 'video/quicktime') return 'video/mp4'
  return mime || 'video/mp4'
}

const WHISPER_MAX_BYTES = 24 * 1024 * 1024 // 24 MB (Whisper hard limit is 25 MB)

// Abort & write error status this many ms into execution, giving us ~1.5 s
// buffer before Vercel Hobby's 10-second function kill.
const SAFE_TIMEOUT_MS = 8_500

export async function transcribeVideo(
  mediaId: string,
  fileId: string,
  fileName: string,
  mimeType: string
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[transcribe] OPENAI_API_KEY not set — skipping')
    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
      transcriptStatus: 'error',
      transcriptNote: 'OPENAI_API_KEY 未設定',
    }).catch(() => {})
    return
  }

  const docRef = adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId)
  const controller = new AbortController()
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  // ── Safety timeout ──────────────────────────────────────────────────────
  // Fires at 8.5 s: aborts the in-flight OpenAI request and writes 'error'
  // to Firestore so the UI shows a retry button instead of spinning forever.
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

      // 1. Check file size via metadata (fast, no download)
      const fileSize = await getDriveFileSize(fileId)
      console.log(`[transcribe] file size: ${fileSize} bytes`)

      if (fileSize > WHISPER_MAX_BYTES) {
        console.warn(`[transcribe] file too large (${fileSize} bytes) — skipping Whisper`)
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

      // 2. Stream Drive file directly to Whisper (no buffering — faster, lower memory)
      const rawExt = fileName.split('.').pop()?.toLowerCase() || 'mp4'
      const whisperExt = toWhisperExt(rawExt)
      const whisperMime = toWhisperMime(mimeType)
      console.log(`[transcribe] ext .${rawExt}→.${whisperExt}, mime ${mimeType}→${whisperMime}`)

      const stream = await getDriveFileStream(fileId)
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

      // Pass AbortController signal so the HTTP request can be cancelled on timeout
      const result = await openai.audio.transcriptions.create(
        {
          file: await toFile(
            stream as unknown as AsyncIterable<Uint8Array>,
            `audio.${whisperExt}`,
            { type: whisperMime }
          ),
          model: 'whisper-1',
          language: 'zh',
        },
        { signal: controller.signal }
      )

      // Only write success if we haven't timed out
      if (!timedOut) {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        const transcript = result.text?.trim() ?? ''
        console.log(`[transcribe] done: "${transcript}"`)
        await docRef.update({
          transcript,
          transcriptStatus: 'done',
          transcriptNote: '',
        })
      }
    } catch (err) {
      // If we timed out, the timeout handler already wrote to Firestore — don't overwrite.
      if (timedOut) return
      if (timeoutHandle) clearTimeout(timeoutHandle)

      const msg = err instanceof Error ? err.message : String(err)
      // AbortError = our own timeout fired and cancelled the request → already handled above
      if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)) return

      console.error('[transcribe] error:', msg)
      await docRef.update({
        transcriptStatus: 'error',
        transcriptNote: msg.slice(0, 300),
      }).catch(() => {})
    }
  })()

  // Wait for whichever finishes first: transcription or the safety timeout
  await Promise.race([transcribePromise, timeoutPromise])
}
