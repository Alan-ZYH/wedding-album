'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getCountFromServer,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Message, MessageDisplayState } from '@/types'

/**
 * Blessings for 祝福管理, loaded by what each tab needs.
 *
 * 置頂 / 播放 / 待播 are what the screen is doing right now. They are bounded —
 * by the rotation size, or briefly by a surge in the queue — so each is a
 * complete live listener. 遮蔽 grows all evening and 全部 grows with it, so
 * both show the newest page live and load older pages on request. Tab counts
 * come from count aggregations (about a read each) rather than from loading
 * everything just to count it.
 *
 * This replaced one listener on up to 1000 unordered documents: past 1000 it
 * returned an arbitrary set by document id, not the newest, and deleted
 * blessings used up the allowance too.
 *
 * Every query here is either a single equality or a single-field ordering, so
 * none needs a composite index — a missing one fails the query outright.
 */

export type FeedTab = 'all' | MessageDisplayState

const PAGE = 50
const LIVE_STATES = ['pinned', 'playing', 'pending'] as const
type LiveState = (typeof LIVE_STATES)[number]
type Cursor = QueryDocumentSnapshot<DocumentData>

const isLive = (s?: MessageDisplayState): s is LiveState =>
  s === 'pinned' || s === 'playing' || s === 'pending'

/** Later of the two timestamps every change stamps, to pick the freshest copy. */
const version = (m: Message) => {
  const a = m.displayStateAt ?? ''
  const b = m.updatedAt ?? ''
  return a > b ? a : b
}

const col = () => collection(db!, 'messages')
const visible = (m: Message) => m.status !== 'deleted'
const toMsg = (d: Cursor) => d.data() as Message

export function useMessageFeed() {
  const [live, setLive] = useState<Record<LiveState, Message[]>>({ pinned: [], playing: [], pending: [] })
  // Newest by creation, and newest by last state change (which is also where
  // anything that just left the rotation or was deleted shows up first)
  const [headAll, setHeadAll] = useState<Message[]>([])
  const [headChanged, setHeadChanged] = useState<Message[]>([])
  // Everything seen so far that is not currently in a live list: blessings
  // that scrolled out of a head, and older pages the admin asked for
  const [cache, setCache] = useState<Map<string, Message>>(new Map())
  const cursors = useRef<{ all?: Cursor; changed?: Cursor }>({})
  const paged = useRef({ all: false, changed: false })
  const [done, setDone] = useState({ all: false, masked: false })
  const [loadingMore, setLoadingMore] = useState(false)
  const [maskedCount, setMaskedCount] = useState<number | null>(null)
  const [readyCount, setReadyCount] = useState(0)

  const remember = useCallback((msgs: Message[]) => {
    setCache((prev) => {
      const next = new Map(prev)
      for (const m of msgs) {
        const cur = next.get(m.id)
        if (!cur || version(m) >= version(cur)) next.set(m.id, m)
      }
      return next
    })
  }, [])

  // ── Live listeners ─────────────────────────────────────────
  useEffect(() => {
    if (!db) return
    let firstSnapshots = 0
    const markReady = () => setReadyCount(++firstSnapshots)

    const unsubs = LIVE_STATES.map((state) => {
      let first = true
      return onSnapshot(
        query(col(), where('displayState', '==', state)),
        (snap) => {
          setLive((prev) => ({ ...prev, [state]: snap.docs.map(toMsg) }))
          if (first) { first = false; markReady() }
        },
        () => { if (first) { first = false; markReady() } }
      )
    })

    const head = (field: 'createdAt' | 'displayStateAt', key: 'all' | 'changed', set: (m: Message[]) => void) => {
      let first = true
      return onSnapshot(
        query(col(), orderBy(field, 'desc'), limit(PAGE)),
        (snap) => {
          const msgs = snap.docs.map(toMsg)
          set(msgs)
          remember(msgs)
          // Older pages continue from the head's end — until the admin starts
          // paging, after which the cursor follows the pages instead
          if (!paged.current[key]) {
            cursors.current[key] = snap.docs[snap.docs.length - 1]
            if (snap.docs.length < PAGE) {
              setDone((d) => ({ ...d, [key === 'all' ? 'all' : 'masked']: true }))
            }
          }
          if (first) { first = false; markReady() }
        },
        () => { if (first) { first = false; markReady() } }
      )
    }
    unsubs.push(head('createdAt', 'all', setHeadAll))
    unsubs.push(head('displayStateAt', 'changed', setHeadChanged))

    return () => unsubs.forEach((u) => u())
  }, [remember])

  // ── Merge, freshest copy wins ──────────────────────────────
  const merged = useMemo(() => {
    const out = new Map<string, Message>()
    const take = (m: Message) => {
      const cur = out.get(m.id)
      if (!cur || version(m) >= version(cur)) out.set(m.id, m)
    }
    cache.forEach(take)
    headAll.forEach(take)
    headChanged.forEach(take)
    LIVE_STATES.forEach((s) => live[s].forEach(take))

    // A copy claiming to be pinned, playing or queued that the live listener
    // for that state no longer holds is stale: it has since left
    const liveIds = new Set(LIVE_STATES.flatMap((s) => live[s].map((m) => m.id)))
    for (const [id, m] of out) {
      if (isLive(m.displayState) && !liveIds.has(id)) out.delete(id)
    }
    return out
  }, [cache, headAll, headChanged, live])

  // ── Counts ──────────────────────────────────────────────────
  // 遮蔽 = everything masked minus the deleted (deleting also masks). Refreshed
  // shortly after anything changes, and on a slow timer as a backstop.
  const refreshCounts = useCallback(async () => {
    if (!db) return
    try {
      const masked = query(col(), where('displayState', '==', 'masked'))
      const deleted = query(col(), where('displayState', '==', 'masked'), where('status', '==', 'deleted'))
      const [a, b] = await Promise.all([getCountFromServer(masked), getCountFromServer(deleted)])
      setMaskedCount(a.data().count - b.data().count)
    } catch { /* keep the last count */ }
  }, [])

  const signature = useMemo(
    () => [...headChanged.map((m) => m.id + version(m)), ...LIVE_STATES.map((s) => live[s].length)].join('|'),
    [headChanged, live]
  )
  useEffect(() => {
    const t = setTimeout(refreshCounts, 1500)
    return () => clearTimeout(t)
  }, [signature, refreshCounts])
  useEffect(() => {
    const t = setInterval(refreshCounts, 30_000)
    return () => clearInterval(t)
  }, [refreshCounts])

  // ── Lists per tab ───────────────────────────────────────────
  const lists = useMemo(() => {
    const all = [...merged.values()].filter(visible)
    return {
      all: [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      pinned: live.pinned.filter(visible).sort((a, b) => (b.displayStateAt ?? '').localeCompare(a.displayStateAt ?? '')),
      // Newest first — the next to be pushed out sits at the bottom
      playing: live.playing.filter(visible).sort((a, b) => (b.playingSince ?? '').localeCompare(a.playingSince ?? '')),
      // In flying order — the next to take off sits at the top
      pending: live.pending.filter(visible).sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0)),
      masked: all
        .filter((m) => (m.displayState ?? 'masked') === 'masked')
        .sort((a, b) => (b.displayStateAt ?? '').localeCompare(a.displayStateAt ?? '')),
    } satisfies Record<FeedTab, Message[]>
  }, [merged, live])

  const counts = useMemo(() => {
    const pinned = lists.pinned.length
    const playing = lists.playing.length
    const pending = lists.pending.length
    const masked = maskedCount ?? lists.masked.length
    return { all: pinned + playing + pending + masked, pinned, playing, pending, masked }
  }, [lists, maskedCount])

  // ── Older pages ────────────────────────────────────────────
  const loadMore = useCallback(async (tab: 'all' | 'masked') => {
    if (!db || loadingMore) return
    setLoadingMore(true)
    try {
      if (tab === 'all') {
        const after = cursors.current.all
        if (!after) return
        paged.current.all = true
        const snap = await getDocs(query(col(), orderBy('createdAt', 'desc'), startAfter(after), limit(PAGE)))
        remember(snap.docs.map(toMsg))
        if (snap.docs.length) cursors.current.all = snap.docs[snap.docs.length - 1]
        if (snap.docs.length < PAGE) setDone((d) => ({ ...d, all: true }))
        return
      }

      // Ordered by last change across every state, so a page may hold few
      // masked blessings; keep going until a screenful turns up or it ends
      paged.current.changed = true
      let found = 0
      for (let i = 0; i < 5 && found < 20; i++) {
        const after = cursors.current.changed
        if (!after) break
        const snap = await getDocs(query(col(), orderBy('displayStateAt', 'desc'), startAfter(after), limit(PAGE)))
        const msgs = snap.docs.map(toMsg)
        remember(msgs)
        found += msgs.filter((m) => (m.displayState ?? 'masked') === 'masked' && m.status !== 'deleted').length
        if (snap.docs.length) cursors.current.changed = snap.docs[snap.docs.length - 1]
        if (snap.docs.length < PAGE) { setDone((d) => ({ ...d, masked: true })); break }
      }
    } catch { /* the button stays; the admin can try again */ }
    finally { setLoadingMore(false) }
  }, [loadingMore, remember])

  /** An edited text shows at once, even on a blessing no listener is watching. */
  const patchLocal = useCallback((id: string, fields: Partial<Message>) => {
    setCache((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, { ...cur, ...fields, updatedAt: new Date().toISOString() })
      return next
    })
  }, [])

  return {
    ready: readyCount >= LIVE_STATES.length + 2,
    lists,
    counts,
    hasMore: { all: !done.all, masked: !done.masked },
    loadingMore,
    loadMore,
    patchLocal,
    refreshCounts,
  }
}
