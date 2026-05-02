/**
 * POST /api/media/[id]/transcribe
 *
 * Triggers Whisper transcription for an existing video.
 * Called:
 *   - by the guest's browser right after upload (fire-and-forget)
 *   - by the admin panel "重試字幕" button
 *
 * This is a dedicated route so it gets a fresh execution budget separate
 * from the upload/complete route, making it reliable on Vercel Hobby (10 s limit).
 * The streaming Drive→Whisper pipeline typically completes in ~5–7 s.
 */

import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { isGuestAuthenticated } from '@/lib/guest-auth'
import { transcribeVideo } from '@/lib/transcribe'
import { Media } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // allow up to 60 s (capped at 10 s on Hobby, 300 s on Pro)

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const isAdmin = await isAdminAuthenticated(req)
  if (!isAdmin && !isGuestAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權' }, { status: 401 })
  }

  try {
    const { id } = await params

    const docRef = adminDb.collection(COLLECTIONS.MEDIA).doc(id)
    const doc = await docRef.get()
    if (!doc.exists) {
      return NextResponse.json({ success: false, error: '找不到媒體' }, { status: 404 })
    }

    const media = doc.data() as Media
    if (media.fileType !== 'video') {
      return NextResponse.json({ success: false, error: '僅影片可生成字幕' }, { status: 400 })
    }

    // Reset to pending so the UI shows progress immediately
    await docRef.update({ transcriptStatus: 'pending', transcript: '', transcriptNote: '' })

    // Run transcription synchronously — this route's entire budget goes to Whisper
    await transcribeVideo(id, media.googleDriveFileId, media.fileName, media.mimeType)

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/media/[id]/transcribe error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
