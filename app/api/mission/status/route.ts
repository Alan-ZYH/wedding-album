import { NextResponse } from 'next/server'
import { MISSIONS } from '@/lib/missions'
import { getMissionCounts } from '@/lib/mission-drive'

export const dynamic = 'force-dynamic'

/** GET /api/mission/status — how many files each mission folder already holds. */
export async function GET() {
  try {
    const counts = await getMissionCounts()
    return NextResponse.json({ success: true, counts })
  } catch (err) {
    // A failed count only costs the ✓ marks; the list must still render.
    console.error('GET /api/mission/status error:', err)
    const counts: Record<string, number> = {}
    for (const m of MISSIONS) counts[m.id] = 0
    return NextResponse.json({ success: true, counts, degraded: true })
  }
}
