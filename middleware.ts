import { NextRequest, NextResponse } from 'next/server'

const ADMIN_COOKIE = 'admin_session'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Admin pages ────────────────────────────────────────────────
  // There is no admin password by design (URL secrecy model).
  // Visiting any /admin page grants an admin cookie; admin-only API
  // routes check for it, so guests who only have the /guest link can
  // never perform admin actions even by calling the API directly.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const res = NextResponse.next()
    if (req.cookies.get(ADMIN_COOKIE)?.value !== '1') {
      res.cookies.set(ADMIN_COOKIE, '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/',
      })
    }
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
