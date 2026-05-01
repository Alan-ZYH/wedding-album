import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authenticated = await isAdminAuthenticated(req)
  if (!authenticated) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
  return NextResponse.json({ authenticated: true })
}
