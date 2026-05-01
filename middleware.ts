import { NextRequest, NextResponse } from 'next/server'

const GUEST_COOKIE = 'guest_session'
const DISPLAY_COOKIE = 'display_session'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

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

  // ── Display page ───────────────────────────────────────────────
  if (pathname === '/display') {
    const validToken = process.env.DISPLAY_ACCESS_TOKEN
    if (!validToken) return NextResponse.next()

    const cookieVal = req.cookies.get(DISPLAY_COOKIE)?.value
    const paramToken = req.nextUrl.searchParams.get('token')

    if (paramToken === validToken) {
      const cleanUrl = req.nextUrl.clone()
      cleanUrl.searchParams.delete('token')
      const res = NextResponse.redirect(cleanUrl)
      res.cookies.set(DISPLAY_COOKIE, validToken, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24, // 1 day
        path: '/',
      })
      return res
    }

    if (cookieVal !== validToken) {
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/guest', '/display'],
}
