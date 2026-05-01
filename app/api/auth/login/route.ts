import { NextRequest, NextResponse } from 'next/server'
import { signAdminToken, getAdminCookieOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()

    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) {
      return NextResponse.json({ success: false, error: '伺服器設定錯誤' }, { status: 500 })
    }

    if (password !== adminPassword) {
      return NextResponse.json({ success: false, error: '密碼錯誤' }, { status: 401 })
    }

    const token = await signAdminToken()
    const { name, options } = getAdminCookieOptions()

    const res = NextResponse.json({ success: true })
    res.cookies.set(name, token, options)
    return res
  } catch {
    return NextResponse.json({ success: false, error: '登入失敗' }, { status: 500 })
  }
}
