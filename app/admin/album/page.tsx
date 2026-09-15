'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Guest } from '@/types'
import type { AlbumEntry } from '@/app/api/admin/album/route'
import { ADMIN_GUEST_ID, withRealName } from '@/lib/guest-names'

const STATE_LABEL: Record<string, string> = {
  pinned: '📌 置頂', playing: '▶️ 播放', pending: '⏳ 待播', masked: '⬜ 遮蔽',
}

interface Person {
  /** What the dropdown shows — a real name, or the screen name if none was given */
  label: string
  guestIds: string[]
}

/**
 * 相簿: every photo and video the album holds — what went to the screen and
 * what guests kept for the couple — newest first, filterable by person.
 *
 * The data comes through admin APIs rather than the browser SDK: the album
 * collection is closed to browsers, which is what keeps it private.
 */
export default function AlbumPage() {
  const [entries, setEntries] = useState<AlbumEntry[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [guests, setGuests] = useState<Guest[]>([])
  const [person, setPerson] = useState('')
  const [preview, setPreview] = useState<AlbumEntry | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/guests').then((r) => r.json()).then((d) => { if (d.success) setGuests(d.data) }).catch(() => {})
  }, [])

  const realNames = useMemo(
    () => Object.fromEntries(guests.filter((g) => g.realName).map((g) => [g.guestId, g.realName!])),
    [guests]
  )

  // One entry per real name: two guests who gave the same real name are one
  // person to the couple, whichever phone they used
  const people = useMemo<Person[]>(() => {
    const byName = new Map<string, string[]>()
    for (const g of guests) {
      const label = g.realName?.trim() || `${g.guestName}（未填本名）`
      byName.set(label, [...(byName.get(label) ?? []), g.guestId])
    }
    const list = [...byName.entries()]
      .map(([label, guestIds]) => ({ label, guestIds }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
    return [{ label: '新人（管理端上傳）', guestIds: [ADMIN_GUEST_ID] }, ...list]
  }, [guests])

  const load = useCallback(async (reset: boolean) => {
    const chosen = people.find((p) => p.label === person)
    const qs = new URLSearchParams()
    if (chosen) qs.set('guestIds', chosen.guestIds.join(','))
    else if (!reset && next) qs.set('before', next)
    if (reset) setLoading(true); else setLoadingMore(true)
    try {
      const res = await fetch(`/api/admin/album?${qs}`)
      const d = await res.json()
      if (d.success) {
        setEntries((prev) => (reset ? d.data : [...prev, ...d.data]))
        setNext(d.next)
      }
    } catch { /* keep what is shown */ }
    finally { setLoading(false); setLoadingMore(false) }
  }, [person, people, next])

  // Reload from the top whenever the person changes
  useEffect(() => { load(true) }, [person]) // eslint-disable-line react-hooks/exhaustive-deps

  const project = async (entry: AlbumEntry) => {
    if (!confirm('把這張照片加入投影？它會進入「待播」，之後出現在大螢幕上。')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/album/${entry.id}/project`, { method: 'POST' })
      const d = await res.json()
      if (!d.success) { alert(d.error || '加入投影失敗'); return }
      const moved: AlbumEntry = { ...entry, source: 'projection', displayState: 'pending' }
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? moved : e)))
      setPreview(moved)
    } catch { alert('網路錯誤，請重試') }
    finally { setBusy(false) }
  }

  const nameOf = (e: AlbumEntry) => withRealName(e.guestName, realNames[e.guestId], e.guestId === ADMIN_GUEST_ID)
  const counts = {
    projection: entries.filter((e) => e.source === 'projection').length,
    album: entries.filter((e) => e.source === 'album').length,
    video: entries.filter((e) => e.fileType === 'video').length,
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">相簿</h1>
          <p className="text-sm text-gray-400">
            {loading ? '載入中…' : `${person ? '' : '已載入 '}${entries.length} 個 · 投影 ${counts.projection} · 存相簿 ${counts.album}${counts.video ? ` · 影片 ${counts.video}` : ''}`}
          </p>
        </div>
        <select
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#c9a84c] w-full sm:w-64"
        >
          <option value="">全部賓客</option>
          {people.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
      </div>

      {!loading && entries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📚</div>
          <p>{person ? '這位賓客還沒有上傳' : '相簿還是空的'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setPreview(e)}
              className="relative aspect-square bg-gray-800 rounded-xl overflow-hidden text-left group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={e.thumbnailUrl}
                alt={e.fileName}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                onError={(ev) => { (ev.target as HTMLImageElement).style.visibility = 'hidden' }}
              />
              {e.fileType === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center text-3xl drop-shadow pointer-events-none">▶️</span>
              )}
              <span className={`absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded ${
                e.source === 'album' ? 'bg-[#c9a84c] text-white' : 'bg-black/60 text-white'
              }`}>
                {e.source === 'album' ? '💝 相簿' : `投影 ${STATE_LABEL[e.displayState ?? ''] ?? ''}`}
              </span>
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pt-4 pb-1.5">
                <span className="block text-xs text-white truncate">{nameOf(e)}</span>
                <span className="block text-[10px] text-white/60">
                  {new Date(e.uploadTime).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!person && next && !loading && (
        <div className="text-center mt-5">
          <button
            onClick={() => load(false)}
            disabled={loadingMore}
            className="text-sm px-5 py-2 rounded-xl border border-[#e8d5a3] bg-white text-[#7a5c2e] hover:bg-[#fdf8f0] disabled:opacity-50"
          >
            {loadingMore ? '載入中…' : '載入更早的'}
          </button>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white text-3xl leading-none" onClick={() => setPreview(null)}>×</button>
          <div onClick={(ev) => ev.stopPropagation()} className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto">
            {preview.fileType === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://lh3.googleusercontent.com/d/${preview.googleDriveFileId}=w1920`}
                alt={preview.fileName}
                className="max-w-full max-h-[72dvh] object-contain rounded-xl mx-auto block"
              />
            ) : (
              <iframe
                src={`https://drive.google.com/file/d/${preview.googleDriveFileId}/preview`}
                allow="autoplay"
                className="w-full aspect-video rounded-xl bg-black"
              />
            )}
            <div className="text-white text-sm mt-3 space-y-1 text-center">
              <p className="font-medium">{nameOf(preview)}</p>
              <p className="opacity-60 text-xs">
                {new Date(preview.uploadTime).toLocaleString('zh-TW')} · {(preview.fileSize / 1024 / 1024).toFixed(1)} MB ·{' '}
                {preview.source === 'album' ? '存入新人相簿' : `投影 ${STATE_LABEL[preview.displayState ?? ''] ?? ''}`}
              </p>
              <a href={preview.googleDriveUrl} target="_blank" rel="noopener noreferrer" className="text-[#c9a84c] text-xs hover:underline">
                在 Google Drive 開啟 →
              </a>
            </div>
            {preview.source === 'album' && preview.fileType === 'photo' && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => project(preview)}
                  disabled={busy}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#c9a84c] hover:bg-[#b8953d] text-white disabled:opacity-50"
                >
                  {busy ? '處理中…' : '📸 加入投影'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
