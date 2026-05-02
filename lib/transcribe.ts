/**
 * lib/transcribe.ts
 *
 * Downloads a video from Google Drive and sends it to OpenAI Whisper for
 * speech-to-text transcription. The result is stored back in Firestore.
 *
 * Called asynchronously (via next/server `after()`) so it does NOT block
 * the upload-complete response to the guest.
 */

import OpenAI, { toFile } from 'openai'
import { downloadDriveFile } from './google-drive'
import { adminDb, COLLECTIONS } from './firebase-admin'

// Whisper supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm
// MOV (.mov / video/quicktime) is NOT listed — remap to mp4 (same container family)
function toWhisperExt(ext: string): string {
  if (ext === 'mov') return 'mp4'
  if (ext === 'mpeg') return 'mpeg'
  const supported = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']
  return supported.includes(ext) ? ext : 'mp4'
}

function toWhisperMime(mime: string): string {
  if (mime === 'video/quicktime') return 'video/mp4'
  return mime || 'video/mp4'
}

// Whisper API hard limit
const WHISPER_MAX_BYTES = 24 * 1024 * 1024 // 24 MB (leave 1 MB margin under 25 MB)

export async function transcribeVideo(
  mediaId: string,
  fileId: string,
  fileName: string,
  mimeType: string
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[transcribe] OPENAI_API_KEY not set — skipping')
    return
  }

  try {
    console.log(`[transcribe] start — mediaId=${mediaId} fileId=${fileId}`)

    // 1. Download the video file from Google Drive
    const buffer = await downloadDriveFile(fileId)
    console.log(`[transcribe] downloaded ${buffer.byteLength} bytes`)

    // 2. Guard: skip files that exceed Whisper's 25 MB limit
    if (buffer.byteLength > WHISPER_MAX_BYTES) {
      console.warn(`[transcribe] file too large (${buffer.byteLength} bytes) — skipping`)
      await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
        transcript: '',
        transcriptStatus: 'done', // treat as done with empty transcript
        transcriptNote: '影片檔案過大（超過 24 MB），無法自動生成字幕',
      })
      return
    }

    // 3. Send to OpenAI Whisper
    //    MOV files must be renamed to .mp4 — Whisper rejects .mov extension
    const rawExt = fileName.split('.').pop()?.toLowerCase() || 'mp4'
    const whisperExt = toWhisperExt(rawExt)
    const whisperMime = toWhisperMime(mimeType)

    console.log(`[transcribe] ext: .${rawExt} → .${whisperExt}, mime: ${mimeType} → ${whisperMime}`)

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const blob = new Blob([new Uint8Array(buffer)], { type: whisperMime })

    const result = await openai.audio.transcriptions.create({
      file: await toFile(blob, `audio.${whisperExt}`),
      model: 'whisper-1',
      language: 'zh', // Traditional/Simplified Chinese — Whisper handles both
    })

    const transcript = result.text?.trim() ?? ''
    console.log(`[transcribe] result: "${transcript}"`)

    // 4. Save transcript + mark done (onSnapshot propagates to display/admin instantly)
    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
      transcript: transcript || '',
      transcriptStatus: 'done',
    })
  } catch (err) {
    // Non-fatal — a transcription failure must never break the upload
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[transcribe] error:', msg)
    try {
      await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
        transcriptStatus: 'error',
        transcriptNote: msg.slice(0, 200), // store short error for debugging
      })
    } catch {}
  }
}
