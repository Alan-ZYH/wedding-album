import { NextRequest, NextResponse } from 'next/server'

const ADMIN_COOKIE = 'admin_session'

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

    return new NextResponse(null, { status: 404 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
