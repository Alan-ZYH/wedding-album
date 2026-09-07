import { NextRequest, NextResponse } from 'next/server'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/unlock?key=…
 *
 * Grants a device admin access and sends it to the panel. The expected key
 * lives in Firestore (settings/config.adminAccessKey), not in this repo, which
 * is public — and not in an environment variable either, so it can be rotated
 * from a script without a redeploy.
 *
 * Middleware cannot do this comparison itself: it runs on the edge runtime,
 * where the Firebase Admin SDK is unavailable.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') ?? ''

  let expected: string | undefined
  try {
    const snap = await adminDb.collection(COLLECTIONS.SETTINGS).doc('config').get()
    expected = snap.data()?.adminAccessKey
  } catch (err) {
    console.error('GET /api/admin/unlock error:', err)
    return new NextResponse(null, { status: 500 })
  }

  // No key configured → open, which keeps local development usable
  const ok = !expected || key === expected
  if (!ok) {
    // Same 404 the middleware gives, so probing tells an attacker nothing
    return new NextResponse(null, { status: 404 })
  }

  const res = NextResponse.redirect(new URL('/admin/dashboard', req.url))
  res.cookies.set('admin_session', '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
  return res
}
