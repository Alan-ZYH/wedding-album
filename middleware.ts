import { NextRequest, NextResponse } from 'next/server'

// Must match ADMIN_COOKIE in lib/admin-secrets.ts. Middleware runs on the edge
// and cannot import that module (it uses node:crypto and the Admin SDK).
const ADMIN_COOKIE = 'admin_session_v3'
const TOKEN_SHAPE = /^[a-f0-9]{64}$/

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Admin pages ────────────────────────────────────────────────
  // Screens the pages only. The edge cannot read Firestore, so it cannot hold
  // the key to verify the signature; it checks the cookie has the right shape.
  // Someone forging that shape reaches an empty page shell — every admin API
  // route verifies the signature itself (lib/auth.ts) and refuses them.
  //
  // A refusal is a 404 rather than a 403: the repo is public, and "this exists
  // but you can't have it" would confirm the panel is here.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()
    if (TOKEN_SHAPE.test(req.cookies.get(ADMIN_COOKIE)?.value ?? '')) return NextResponse.next()

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
