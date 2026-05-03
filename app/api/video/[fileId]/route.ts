import { NextRequest } from 'next/server'
import { getAuth } from '@/lib/google-drive'

export const dynamic = 'force-dynamic'

/**
 * GET /api/video/[fileId]
 *
 * Returns a 302 redirect to the Google Drive media URL so the browser
 * streams the video directly from Google's CDN.
 *
 * Why redirect instead of proxy?
 *   Proxying a video stream through a Vercel serverless function hits the
 *   10-second execution limit (Hobby plan), causing the stream to be cut
 *   mid-playback and the video to freeze on the last buffered frame.
 *   With a redirect, Vercel only generates the auth token (<1 s), then the
 *   browser handles the rest — no timeout, no streaming overhead.
 *
 * The access_token in the redirect URL expires in ~1 hour; subsequent
 * byte-range requests for seeking go directly to googleapis.com and reuse
 * the same token URL.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params
  if (!fileId) return new Response('Missing fileId', { status: 400 })

  try {
    const auth = getAuth()
    const token = await auth.getAccessToken()
    if (!token) return new Response('Auth failed', { status: 500 })

    // Build the authenticated media URL and redirect the browser there.
    // The <video> element streams directly from Google — no Vercel I/O involved.
    const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`)
    mediaUrl.searchParams.set('alt', 'media')
    mediaUrl.searchParams.set('supportsAllDrives', 'true')
    mediaUrl.searchParams.set('access_token', token)

    return Response.redirect(mediaUrl.toString(), 302)
  } catch (err) {
    console.error('GET /api/video error:', err)
    return new Response('Video redirect error', { status: 500 })
  }
}
