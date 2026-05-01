import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-please-set-env'
)
const COOKIE_NAME = 'wedding_admin_token'
const TOKEN_EXPIRY = '24h'

export async function signAdminToken(): Promise<string> {
  return await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET)
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET)
    return true
  } catch {
    return false
  }
}

export async function isAdminAuthenticated(req?: NextRequest): Promise<boolean> {
  try {
    let token: string | undefined

    if (req) {
      token = req.cookies.get(COOKIE_NAME)?.value
    } else {
      // Next.js 15: cookies() is async
      const cookieStore = await cookies()
      token = cookieStore.get(COOKIE_NAME)?.value
    }

    if (!token) return false
    return await verifyAdminToken(token)
  } catch {
    return false
  }
}

export function getAdminCookieOptions() {
  return {
    name: COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24,
      path: '/',
    },
  }
}
