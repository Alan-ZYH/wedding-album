import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { isGuestAuthenticated } from '@/lib/guest-auth'
import { sanitizeText, sanitizeName } from '@/lib/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { Message } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const isAdmin = await isAdminAuthenticated(req)
    const { searchParams } = new URL(req.url)
    const guestId = searchParams.get('guestId')

    const col = adminDb.collection(COLLECTIONS.MESSAGES)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = col
    if (!isAdmin) {
      q = q.where('status', '==', 'active')
      if (guestId) {
        q = q.where('guestId', '==', guestId)
      }
    }
    q = q.orderBy('createdAt', 'desc').limit(500)

    const snapshot = await q.get()
    const messages: Message[] = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as Message)

    return NextResponse.json({ success: true, data: messages })
  } catch (err) {
    console.error('GET /api/messages error:', err)
    return NextResponse.json({ success: false, error: '無法取得祝福列表' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const isAdmin = await isAdminAuthenticated(req)
  if (!isAdmin && !isGuestAuthenticated(req)) {
    return NextResponse.json({ success: false, error: '未授權存取' }, { status: 401 })
  }

  if (!checkRateLimit(req, 20)) {
    return NextResponse.json({ success: false, error: '請求過於頻繁' }, { status: 429 })
  }

  try {
    const body = await req.json()

    const guestId = body.guestId as string
    const guestNameRaw = body.guestName as string
    const messageRaw = body.message as string

    if (!messageRaw?.trim()) {
      return NextResponse.json({ success: false, error: '祝福內容不可為空' }, { status: 400 })
    }

    const message = sanitizeText(messageRaw)
    const guestName = sanitizeName(guestNameRaw || '匿名')

    if (!message) {
      return NextResponse.json({ success: false, error: '祝福內容無效' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    const doc: Message = {
      id,
      guestId: guestId || 'admin',
      guestName,
      message,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      priority: isAdmin ? (body.priority || 1) : 1,
    }

    await adminDb.collection(COLLECTIONS.MESSAGES).doc(id).set(doc)
    return NextResponse.json({ success: true, data: doc })
  } catch (err) {
    console.error('POST /api/messages error:', err)
    return NextResponse.json({ success: false, error: '新增祝福失敗' }, { status: 500 })
  }
}
