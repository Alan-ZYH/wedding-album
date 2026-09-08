'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Guest } from '@/types'

/**
 * Real names by guest id, for the admin screens.
 *
 * Media and Message records only carry the 投影顯示名稱 — deliberately, so the
 * projection can never leak a real name. The admin pages need the other half,
 * and the only place it exists is the guests collection, which the browser SDK
 * cannot read; hence the API and the polling.
 */
export function useRealNames(guestIds: string[] = [], intervalMs = 30_000) {
  const [names, setNames] = useState<Record<string, string>>({})
  const loadedAt = useRef(0)
  const seeded = useRef(false)

  const load = useCallback(async () => {
    loadedAt.current = Date.now()
    try {
      const res = await fetch('/api/guests')
      const data = await res.json()
      if (!data.success) return
      const map: Record<string, string> = {}
      for (const g of data.data as Guest[]) {
        if (g.realName) map[g.guestId] = g.realName
      }
      setNames(map)
      seeded.current = true
    } catch { /* keep whatever we had */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, intervalMs)
    return () => clearInterval(t)
  }, [load, intervalMs])

  // A guest who arrives mid-reception would otherwise show up nameless until
  // the next poll, which is most of a minute of the admin seeing half an
  // answer. Seeing an id we don't know is the signal to look again — rate
  // limited, so a long list of guests we simply have no real name for (anyone
  // who joined before the album asked) cannot turn into a request loop.
  const unknown = guestIds.filter((id) => id && !(id in names)).join(',')
  useEffect(() => {
    if (!unknown || !seeded.current) return
    if (Date.now() - loadedAt.current < 5_000) return
    load()
  }, [unknown, load])

  return names
}

/** Fixed id for everything the couple posts from the admin panel. */
export const ADMIN_GUEST_ID = 'admin'

/**
 * 「投影名稱（本名）」 for a guest, 「投影名稱（管理端）」 for the couple.
 *
 * The couple has no entry in the guests collection — nothing throttles or
 * blocks them, so nothing ever creates one — which would otherwise leave their
 * blessings as a bare name, indistinguishable from a guest whose real name has
 * yet to load.
 */
export function withRealName(guestName: string, realName?: string, fromAdmin?: boolean) {
  if (fromAdmin) return `${guestName}（管理端）`
  return realName && realName !== guestName ? `${guestName}（${realName}）` : guestName
}
