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

    // 2. Send to OpenAI Whisper
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const ext = fileName.split('.').pop()?.toLowerCase() || 'mp4'
    const safeMime = mimeType || `video/${ext}`
    const blob = new Blob([new Uint8Array(buffer)], { type: safeMime })

    const result = await openai.audio.transcriptions.create({
      file: await toFile(blob, `audio.${ext}`),
      model: 'whisper-1',
      language: 'zh',   // Traditional/Simplified Chinese — Whisper handles both
    })

    const transcript = result.text?.trim() ?? ''
    console.log(`[transcribe] result: "${transcript}"`)

    // 3. Save transcript + mark done (onSnapshot propagates to display/admin instantly)
    await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
      transcript: transcript || '',
      transcriptStatus: 'done',
    })
  } catch (err) {
    // Non-fatal — a transcription failure must never break the upload
    console.error('[transcribe] error:', err instanceof Error ? err.message : String(err))
    try {
      await adminDb.collection(COLLECTIONS.MEDIA).doc(mediaId).update({
        transcriptStatus: 'error',
      })
    } catch {}
  }
}
