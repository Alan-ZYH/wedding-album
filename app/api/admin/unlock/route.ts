import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE, getAdminSecrets, safeEqual, sessionTokenFor } from '@/lib/admin-secrets'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
} as const

/**
 * A confirmation page rather than a bare redirect.
 *
 * A 307 straight to /admin/dashboard works on a desktop browser, but on a
 * phone — particularly when the link is opened from inside another app's web
 * view — a cookie that fails to stick lands you on the middleware's 404 with
 * no way to tell a wrong key from a dropped cookie. This way the key check and
 * the navigation are separate steps, each with its own visible outcome.
 */
function page(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>婚禮相簿管理端</title>
<style>
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
       background:#fdf8f0;color:#7a5c2e;font-family:system-ui,-apple-system,"PingFang TC",sans-serif;padding:24px}
  .card{background:#fff;border:1px solid #e8d5a3;border-radius:20px;padding:32px 28px;max-width:360px;width:100%;text-align:center}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:14px;color:#8a8a8a;margin:0 0 20px;line-height:1.7}
  a{display:block;background:#c9a84c;color:#fff;text-decoration:none;padding:14px;border-radius:14px;font-size:16px;font-weight:500}
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } }
  )
}

/** GET /api/admin/unlock?key=… — grants this device access to /admin. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') ?? ''

  let expected: string | undefined
  try {
    // Read fresh: a key rotated seconds ago must work here at once
    expected = (await getAdminSecrets(true)).adminAccessKey
  } catch (err) {
    console.error('GET /api/admin/unlock error:', err)
    return new NextResponse(null, { status: 500, headers: NO_STORE })
  }

  // In production a missing key means nobody gets in. The old default was
  // "open", which would have unlocked anyone had the key ever gone missing.
  const devOpen = process.env.NODE_ENV !== 'production' && !expected
  if (!devOpen && (!expected || !safeEqual(key, expected))) {
    // The same 404 the middleware gives, so probing tells an attacker nothing
    return new NextResponse(null, { status: 404, headers: NO_STORE })
  }

  const res = page(`
    <h1>✓ 已解鎖</h1>
    <p>這台裝置 30 天內都能直接開啟管理端，不用再帶密鑰。</p>
    <a href="/admin/dashboard">進入管理端</a>
  `)
  res.cookies.set(ADMIN_COOKIE, sessionTokenFor(expected ?? 'dev'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
  return res
}
