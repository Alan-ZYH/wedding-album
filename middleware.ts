import { NextRequest, NextResponse } from 'next/server'

const GUEST_COOKIE = 'guest_session'
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

  // ── Guest page ─────────────────────────────────────────────────
  if (pathname === '/guest') {
    const validToken = process.env.GUEST_ACCESS_TOKEN
    if (!validToken) return NextResponse.next() // not configured, skip

    const cookieVal = req.cookies.get(GUEST_COOKIE)?.value
    const paramToken = req.nextUrl.searchParams.get('token')

    // Valid token in URL → set cookie and redirect to clean URL
    if (paramToken === validToken) {
      const cleanUrl = req.nextUrl.clone()
      cleanUrl.searchParams.delete('token')
      const res = NextResponse.redirect(cleanUrl)
      res.cookies.set(GUEST_COOKIE, validToken, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      })
      return res
    }

    // No valid session → unauthorized
    if (cookieVal !== validToken) {
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/guest', '/admin', '/admin/:path*'],
}
