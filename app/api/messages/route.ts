import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { checkGuestGate, gateErrorMessage, recordGuestAction } from '@/lib/guests'
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
    if (isAdmin) {
      q = q.orderBy('createdAt', 'desc')
    } else {
      // Filtered reads are sorted in memory rather than by Firestore: ordering
      // alongside these equality filters needs a composite index that doesn't
      // exist, and the query fails outright without one. A few hundred rows
      // sort fine here.
      q = q.where('status', '==', 'active')
      if (guestId) q = q.where('guestId', '==', guestId)
    }
    q = q.limit(500)

    const snapshot = await q.get()
    const messages: Message[] = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as Message)
    if (!isAdmin) {
      messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }

    return NextResponse.json({ success: true, data: messages })
  } catch (err) {
    console.error('GET /api/messages error:', err)
    return NextResponse.json({ success: false, error: '無法取得祝福列表' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Open to anyone with the link; blocking and cooldown are enforced below.
  const isAdmin = await isAdminAuthenticated(req)

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

    // Block list + 30s cooldown, tracked separately from photo uploads
    if (!isAdmin && guestId) {
      const gate = await checkGuestGate(guestId, 'message')
      if (!gate.ok) {
        return NextResponse.json(
          {
            success: false,
            error: gateErrorMessage(gate),
            reason: gate.reason,
            remaining: gate.reason === 'cooldown' ? gate.remaining : undefined,
          },
          { status: gate.reason === 'blocked' ? 403 : 429 }
        )
      }
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
      fromAdmin: isAdmin,
    }

    await adminDb.collection(COLLECTIONS.MESSAGES).doc(id).set(doc)

    // Only successful posts advance the cooldown window
    if (!isAdmin && guestId) {
      await recordGuestAction(guestId, guestName, 'message')
    }

    return NextResponse.json({ success: true, data: doc })
  } catch (err) {
    console.error('POST /api/messages error:', err)
    return NextResponse.json({ success: false, error: '新增祝福失敗' }, { status: 500 })
  }
}
