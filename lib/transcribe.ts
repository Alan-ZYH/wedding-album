/**
 * lib/transcribe.ts
 *
 * Streams a video from Google Drive directly to OpenAI Whisper — no full
 * download to memory. Drive → Whisper pipeline reduces latency significantly,
 * making it feasible even within Vercel Hobby's 10-second function limit.
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

  try {
    console.log(`[transcribe] start — mediaId=${mediaId} fileId=${fileId}`)

    // 1. Check file size via metadata (fast, no download)
    const fileSize = await getDriveFileSize(fileId)
    console.log(`[transcribe] file size: ${fileSize} bytes`)

    if (fileSize > WHISPER_MAX_BYTES) {
      console.warn(`[transcribe] file too large (${fileSize} bytes) — skipping Whisper`)
      await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
        transcript: '',
        transcriptStatus: 'done',
        transcriptNote: '影片檔案過大（超過 24 MB），無法自動生成字幕',
      })
      return
    }

    // 2. Stream Drive file directly to Whisper (no buffering — faster, lower memory)
    const rawExt = fileName.split('.').pop()?.toLowerCase() || 'mp4'
    const whisperExt = toWhisperExt(rawExt)
    const whisperMime = toWhisperMime(mimeType)
    console.log(`[transcribe] ext .${rawExt}→.${whisperExt}, mime ${mimeType}→${whisperMime}`)

    const stream = await getDriveFileStream(fileId)
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const result = await openai.audio.transcriptions.create({
      // toFile accepts a Node.js Readable (AsyncIterable) — no need to buffer first
      file: await toFile(
        stream as unknown as AsyncIterable<Uint8Array>,
        `audio.${whisperExt}`,
        { type: whisperMime }
      ),
      model: 'whisper-1',
      language: 'zh',
    })

    const transcript = result.text?.trim() ?? ''
    console.log(`[transcribe] done: "${transcript}"`)

    // 3. Write result to Firestore (onSnapshot propagates instantly)
    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
      transcript,
      transcriptStatus: 'done',
      transcriptNote: '',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[transcribe] error:', msg)
    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
      transcriptStatus: 'error',
      transcriptNote: msg.slice(0, 300),
    }).catch(() => {})
  }
}
