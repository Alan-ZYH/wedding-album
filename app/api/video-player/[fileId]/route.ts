import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/video-player/[fileId]
 *
 * Returns a minimal same-origin HTML page containing an autoplaying <video>.
 * Because the iframe src is same-origin (our domain), the browser grants
 * autoplay permission — solving the Google Drive iframe autoplay block.
 *
 * When the video ends, posts { type: 'videoEnded' } to the parent window
 * so DisplayClient can advance to the next slide.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000; overflow: hidden; width: 100vw; height: 100vh; }
  video { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body>
<video
  autoplay
  muted
  playsinline
  preload="auto"
  src="/api/video/${fileId}"
  onended="window.parent.postMessage({type:'videoEnded'},'*')"
  onerror="window.parent.postMessage({type:'videoEnded'},'*')"
></video>
<script>
  // Attempt unmuted playback after user has interacted with the parent page
  const v = document.querySelector('video');
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'unmute') { v.muted = false; }
  });
  // Ensure playback starts
  v.play().catch(function() { v.muted = true; v.play(); });
</script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
