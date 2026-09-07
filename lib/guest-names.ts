'use client'

import { useState, useEffect } from 'react'
import { Guest } from '@/types'

/**
 * Real names by guest id, for the admin screens.
 *
 * Media and Message records only carry the 投影顯示名稱 — deliberately, so the
 * projection can never leak a real name. The admin pages need the other half,
 * and the only place it exists is the guests collection, which the browser SDK
 * cannot read; hence the API and the polling.
 */
export function useRealNames(intervalMs = 30_000) {
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/guests')
        const data = await res.json()
        if (!alive || !data.success) return
        const map: Record<string, string> = {}
        for (const g of data.data as Guest[]) {
          if (g.realName) map[g.guestId] = g.realName
        }
        setNames(map)
      } catch { /* keep whatever we had */ }
    }
    load()
    const t = setInterval(load, intervalMs)
    return () => { alive = false; clearInterval(t) }
  }, [intervalMs])

  return names
}

/** 「投影名稱（本名）」, falling back to the display name alone. */
export function withRealName(guestName: string, realName?: string) {
  return realName && realName !== guestName ? `${guestName}（${realName}）` : guestName
}
