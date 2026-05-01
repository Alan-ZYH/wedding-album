import { NextRequest } from 'next/server'

export function isGuestAuthenticated(req: NextRequest): boolean {
  const validToken = process.env.GUEST_ACCESS_TOKEN
  if (!validToken) return true // token not configured → open (dev mode)
  return req.cookies.get('guest_session')?.value === validToken
}
