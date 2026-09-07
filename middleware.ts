import { NextRequest, NextResponse } from 'next/server'

// Renamed from 'admin_session': the middleware used to hand that cookie to
// anyone who merely opened /admin, and those are valid for 30 days. A new name
// retires them all at once.
const ADMIN_COOKIE = 'admin_key_v2'

const adminCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: '/',
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Admin pages ────────────────────────────────────────────────
  // There is still no password to type — access is by knowing a URL. The key
  // itself is NOT checked here: middleware runs on the edge and cannot reach
  // Firestore, so /api/admin/unlock does the comparison and sets this cookie.
  // Here we only ask whether the device has already been let in.
  //
  // A wrong or missing key gets 404 rather than 403: the repo is public, so
  // "this path exists but you can't have it" would confirm the panel is here.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (req.cookies.get(ADMIN_COOKIE)?.value === '1') return NextResponse.next()

    // Local development stays open — `npm run dev` should not need the key
    if (process.env.NODE_ENV !== 'production') {
      const res = NextResponse.next()
      res.cookies.set(ADMIN_COOKIE, '1', adminCookieOptions)
      return res
    }

    // no-store so a phone that was refused before unlocking can't be shown a
    // remembered 404 afterwards
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
