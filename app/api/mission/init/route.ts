import { NextRequest, NextResponse } from 'next/server'
import { findMission } from '@/lib/missions'
import { createMissionUploadSession, invalidateMissionCounts } from '@/lib/mission-drive'
import { validateFile, sanitizeName } from '@/lib/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mission/init
 *
 * Opens a Google Drive resumable session inside the mission's own folder and
 * hands the URL back, so the phone PUTs the bytes straight to Drive and never
 * pushes them through Vercel's 4.5 MB request limit.
 *
 * Body: { missionId, guestName, mimeType, fileSize, originalName }
 */
export async function POST(req: NextRequest) {
  try {
    const { missionId, guestName: rawName, mimeType, fileSize, originalName } = await req.json()

    const mission = findMission(String(missionId ?? ''))
    if (!mission) {
      return NextResponse.json({ success: false, error: '找不到這個任務' }, { status: 400 })
    }

    const guestName = sanitizeName(String(rawName ?? ''))
    if (!guestName) {
      return NextResponse.json({ success: false, error: '請先輸入名稱' }, { status: 400 })
    }

    if (!checkRateLimit(req, parseInt(process.env.RATE_LIMIT_MAX || '10'), `mission:${guestName}`)) {
      return NextResponse.json({ success: false, error: '上傳過於頻繁，請稍後再試' }, { status: 429 })
    }

    const validation = validateFile(mimeType || '', fileSize || 0)
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }

    // 任務3_小明_1103_2015.mp4 — sorts by mission, names the guest, stays unique.
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const ext = String(originalName ?? '').split('.').pop()?.toLowerCase().slice(0, 5) || 'bin'
    const safeName = guestName.replace(/[^a-zA-Z0-9一-鿿]/g, '').slice(0, 12) || '賓客'
    const fileName = `${mission.label}_${safeName}_${stamp}.${ext}`

    const uploadUrl = await createMissionUploadSession(mission, fileName, mimeType, fileSize)
    invalidateMissionCounts()

    return NextResponse.json({ success: true, uploadUrl, fileName })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/mission/init error:', msg)
    return NextResponse.json({ success: false, error: `上傳初始化失敗: ${msg}` }, { status: 500 })
  }
}
