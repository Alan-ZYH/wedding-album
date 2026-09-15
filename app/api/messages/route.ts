import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { adminDb, COLLECTIONS } from '@/lib/firebase-admin'
import { isAdminAuthenticated } from '@/lib/auth'
import { checkGuestGate, gateErrorMessage, recordGuestAction } from '@/lib/guests'
import { admitMessage, queueFields, PinLimitError } from '@/lib/message-pool'
import { isBlessingColor } from '@/lib/blessing-colors'
import { sanitizeText, sanitizeName, messageTooLong } from '@/lib/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { Message } from '@/types'
import { getSettings } from '@/lib/settings'
import { messagesOpen, CLOSED_MESSAGE } from '@/lib/guest-access'

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

  try {
    const body = await req.json()

    const guestId = body.guestId as string

    // Keyed on IP and guest together, as uploads are. On IP alone, everyone on
    // the venue WiFi — or behind one carrier's shared address — drew from a
    // single allowance of 20 a minute, so the 21st guest to send a blessing
    // after a toast was told 請求過於頻繁 for something they never did.
    if (!checkRateLimit(req, 20, guestId || undefined)) {
      return NextResponse.json({ success: false, error: '請求過於頻繁' }, { status: 429 })
    }
    const guestNameRaw = body.guestName as string
    const messageRaw = body.message as string

    if (!messageRaw?.trim()) {
      return NextResponse.json({ success: false, error: '祝福內容不可為空' }, { status: 400 })
    }

    if (!isAdmin && !messagesOpen(await getSettings())) {
      return NextResponse.json({ success: false, error: CLOSED_MESSAGE, reason: 'closed' }, { status: 403 })
    }

    // Block list + 30s cooldown, tracked separately from photo uploads
    if (!isAdmin && guestId) {
      const gate = await checkGuestGate(guestId, 'message')
      if (!gate.ok) {
        return NextResponse.json(
          {
            success: false,
            error: gateErrorMessage(gate, 'message'),
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
    const tooLong = messageTooLong(message)
    if (tooLong) return NextResponse.json({ success: false, error: tooLong }, { status: 400 })

    const now = new Date().toISOString()
    const id = uuidv4()

    const doc: Omit<Message, 'displayState' | 'displayStateAt' | 'playingSince'> = {
      id,
      guestId: guestId || 'admin',
      guestName,
      message,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      priority: isAdmin ? (body.priority || 1) : 1,
      // Requires BOTH admin auth and an explicit flag: the admin cookie is set
      // for the whole site, so the couple posting from the guest page would
      // otherwise have their blessing styled as if it came from the panel.
      fromAdmin: isAdmin && body.fromAdmin === true,
      // Frozen here, once. Only the couple gets a plate, only from the preset
      // list, and nothing ever updates this field afterwards.
      color: isAdmin && body.fromAdmin === true && isBlessingColor(body.color)
        ? body.color.toLowerCase()
        : null,
    }

    // Into the queue: the screen flies it next, and only then does it join the
    // rotation and push the oldest out. The couple may pin theirs as they post,
    // which takes a slot at once; a guest never can.
    const ref = adminDb.collection(COLLECTIONS.MESSAGES).doc(id)
    const pin = isAdmin && body.pinned === true
    try {
      if (pin) await admitMessage({ ref, as: 'pinned', create: doc })
      else await ref.set({ ...doc, ...queueFields() })
    } catch (err) {
      if (err instanceof PinLimitError) {
        return NextResponse.json({ success: false, error: err.message }, { status: 409 })
      }
      throw err
    }

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
