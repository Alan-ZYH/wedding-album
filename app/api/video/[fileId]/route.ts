import { NextRequest } from 'next/server'
import { getAuth } from '@/lib/google-drive'

export const dynamic = 'force-dynamic'

/**
 * Gives the browser a short-lived authenticated Google Drive media URL.
 *
 * We intentionally redirect instead of proxying the stream through Vercel:
 * Vercel functions can time out during video playback, while Google Drive can
 * serve the actual bytes with Range support directly to the browser.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params
  const auth = getAuth()
  const token = await auth.getAccessToken()

  if (!token) {
    return new Response('Unable to authorize video playback', { status: 500 })
  }

  const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`)
  mediaUrl.searchParams.set('alt', 'media')
  mediaUrl.searchParams.set('supportsAllDrives', 'true')
  mediaUrl.searchParams.set('access_token', token)

  return Response.redirect(mediaUrl.toString(), 302)
}
