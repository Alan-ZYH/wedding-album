import { NextRequest } from 'next/server'
import { getAuth } from '@/lib/google-drive'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/video/[fileId]
 *
 * Proxies a Google Drive video through our server so the browser can use
 * <video autoplay muted src="/api/video/{fileId}"> without hitting:
 *   - CORS restrictions
 *   - Google's virus-scan redirect page (blocks <video> src for large files)
 *
 * Supports byte-range requests so browsers can seek and buffer efficiently.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params
  if (!fileId) return new Response('Missing fileId', { status: 400 })

  try {
    const auth = getAuth()
    const token = await auth.getAccessToken()
    if (!token) return new Response('Auth failed', { status: 500 })

    const range = req.headers.get('range')

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(range ? { Range: range } : {}),
        },
      }
    )

    if (!driveRes.ok && driveRes.status !== 206) {
      return new Response(`Drive error: ${driveRes.status}`, { status: driveRes.status })
    }

    const resHeaders = new Headers()
    const contentType = driveRes.headers.get('content-type')
    const contentLength = driveRes.headers.get('content-length')
    const contentRange = driveRes.headers.get('content-range')

    if (contentType) resHeaders.set('Content-Type', contentType)
    if (contentLength) resHeaders.set('Content-Length', contentLength)
    if (contentRange) resHeaders.set('Content-Range', contentRange)
    resHeaders.set('Accept-Ranges', 'bytes')
    resHeaders.set('Cache-Control', 'public, max-age=3600')

    return new Response(driveRes.body, {
      status: driveRes.status, // 200 or 206 (partial)
      headers: resHeaders,
    })
  } catch (err) {
    console.error('GET /api/video error:', err)
    return new Response('Video proxy error', { status: 500 })
  }
}
