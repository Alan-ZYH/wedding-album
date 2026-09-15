import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { ADMIN_COOKIE, getAdminSecrets, safeEqual, sessionTokenFor } from './admin-secrets'

/**
 * Admin authentication uses the URL-secrecy model — there is no password to
 * type. Visiting /api/admin/unlock?key=… with the right key sets a cookie
 * holding a signature of that key; every admin-only API route recomputes the
 * signature and compares. This is the check that actually protects the data —
 * middleware only screens the pages.
 *
 * Local development (`npm run dev`) is open, as before.
 */
export async function isAdminAuthenticated(req?: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  try {
    const presented = req
      ? req.cookies.get(ADMIN_COOKIE)?.value
      : (await cookies()).get(ADMIN_COOKIE)?.value
    if (!presented) return false

    const { adminAccessKey } = await getAdminSecrets()
    if (!adminAccessKey) return false // no key configured: nobody is admin
    return safeEqual(presented, sessionTokenFor(adminAccessKey))
  } catch {
    return false
  }
}
