/**
 * POST /api/media/[id]/transcribe
 *
 * Triggers Whisper transcription for an existing video.
 * Called:
 *   - by the guest's browser right after upload (fire-and-forget)
 *   - by the admin panel "重試字幕" button
 *   - by the guest "字幕失敗・重試" button
 *
 * Optimisations to fit within Vercel Hobby's 10-second limit:
 *   - fileSize is forwarded from Firestore so transcribeVideo can skip the
 *     extra Drive metadata API call
 *   - The "reset to pending" Firestore write is fire-and-forget so
 *     transcription starts immediately without waiting for it
 */

import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { isGuestAuthenticated } from '@/lib/guest-auth'
import { transcribeVideo } from '@/lib/transcribe'
import { Media } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // capped at 10 s on Hobby, 300 s on Pro

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

    // Fire-and-forget: reset to pending so the UI updates immediately, but
    // don't block — transcription should start as soon as possible.
    docRef.update({ transcriptStatus: 'pending', transcript: '', transcriptNote: '' })
      .catch(() => {})

    // Run transcription synchronously; pass known fileSize to skip an extra
    // Drive API metadata call inside transcribeVideo.
    await transcribeVideo(
      id,
      media.googleDriveFileId,
      media.fileName,
      media.mimeType,
      media.fileSize,
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/media/[id]/transcribe error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
