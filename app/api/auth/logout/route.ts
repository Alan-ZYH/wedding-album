import { NextResponse } from 'next/server'
import { getAdminCookieOptions } from '@/lib/auth'

export async function POST() {
  const { name } = getAdminCookieOptions()
  const res = NextResponse.json({ success: true })
  res.cookies.delete(name)
  return res
}
