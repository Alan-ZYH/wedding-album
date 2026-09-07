'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Media, DisplayState } from '@/types'
import { useRealNames, withRealName } from '@/lib/guest-names'

const PAGE_SIZE = 60 // cards rendered at a time; "load more" reveals the next batch

function MediaPageContent() {
  const searchParams = useSearchParams()
  const [media, setMedia] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState({
    pending: searchParams.get('pending') === 'true',
    state: 'all' as 'all' | DisplayState | 'deleted',
  })
  const [preview, setPreview] = useState<Media | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const realNames = useRealNames()

  // Real-time listener — updates instantly when guests upload
  useEffect(() => {
    if (!db) return
    const q = query(collection(db, 'media'), orderBy('uploadTime', 'desc'), limit(1000))
    const unsub = onSnapshot(q, (snap) => {
      setMedia(snap.docs.map((d) => d.data() as Media))
      setLoading(false)
    }, () => { setLoading(false) })
    return () => unsub()
  }, [])

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [filter.pending, filter.state])

  // 「刪除」是 status，其餘四種是 displayState；預設不顯示已刪除的
  const matchesState = (m: Media, state: typeof filter.state) => {
    if (state === 'deleted') return m.status === 'deleted'
    if (m.status === 'deleted') return false
    return state === 'all' || (m.displayState ?? 'pending') === state
  }

  // Playback order: dragged order where set, upload order otherwise
  const orderOf = (m: Media) => m.sortOrder ?? Number.MAX_SAFE_INTEGER
  const filtered = media.filter((m) => {
    if (!matchesState(m, filter.state)) return false
    // ?pending=true from the dashboard still narrows to unapproved media
    if (filter.pending && m.approved) return false
    return true
  }).sort((a, b) => {
    const d = orderOf(a) - orderOf(b)
    return d !== 0 ? d : b.uploadTime.localeCompare(a.uploadTime)
  })

  const counts = {
    all: media.filter((m) => m.status !== 'deleted').length,
    pinned: media.filter((m) => m.status !== 'deleted' && m.displayState === 'pinned').length,
    playing: media.filter((m) => m.status !== 'deleted' && m.displayState === 'playing').length,
    pending: media.filter((m) => m.status !== 'deleted' && (m.displayState ?? 'pending') === 'pending').length,
    masked: media.filter((m) => m.status !== 'deleted' && m.displayState === 'masked').length,
    deleted: media.filter((m) => m.status === 'deleted').length,
  }

  // ── Drag to reorder ──────────────────────────────────────────
  // Reorders within the visible list and persists the whole visible order, so
  // dragging while a filter is applied stays predictable.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  const handleDrop = async (targetId: string) => {
    const sourceId = dragId
    setDragId(null)
    setDragOverId(null)
    if (!sourceId || sourceId === targetId) return

    const visible = filtered.slice(0, visibleCount)
    const from = visible.findIndex((m) => m.id === sourceId)
    const to = visible.findIndex((m) => m.id === targetId)
    if (from < 0 || to < 0) return

    const next = [...visible]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)

    // Optimistic: renumber locally so the grid settles before the round trip
    const ids = next.map((m) => m.id)
    setMedia((prev) =>
      prev.map((m) => {
        const i = ids.indexOf(m.id)
        return i < 0 ? m : { ...m, sortOrder: (i + 1) * 10 }
      })
    )

    setSavingOrder(true)
    try {
      await fetch('/api/media/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    } catch {}
    finally { setSavingOrder(false) }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((m) => m.id)))
  }

  const updateMedia = async (id: string, updates: Record<string, unknown>) => {
    setProcessing(id)
    try {
      const res = await fetch(`/api/media/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if ((await res.json()).success) {
        setMedia((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } as Media : m))
      }
    } catch {}
    finally { setProcessing(null) }
  }

  // ❌ moves a photo to the 刪除 tab and off the screen. The Google Drive file
  // stays: on the wedding day a mis-tap must be undoable, and the backup runs
  // off Drive, so purging here would lose the photo from the album for good.
  const trashMedia = (id: string) =>
    updateMedia(id, { status: 'deleted', displayState: 'masked' })

  const restoreMedia = (id: string) =>
    updateMedia(id, { status: 'active', displayState: 'pending' })

  // The only path that touches Google Drive — reachable from the 刪除 tab alone
  const purgeMedia = async (id: string) => {
    if (!confirm('確定永久刪除？這會一併刪除 Google Drive 裡的檔案，無法復原。')) return
    setProcessing(id)
    try {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' })
      if ((await res.json()).success) {
        setMedia((prev) => prev.filter((m) => m.id !== id))
        setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
      }
    } catch {}
    finally { setProcessing(null) }
  }

  // Run async operations over ids with bounded concurrency (10 at a time)
  const runBatch = async (ids: string[], op: (id: string) => Promise<void>) => {
    const CONCURRENCY = 10
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      await Promise.all(ids.slice(i, i + CONCURRENCY).map(op))
    }
  }

  const batchUpdate = async (updates: Record<string, unknown>) => {
    const ids = [...selected]
    setProcessing('batch')
    try {
      await runBatch(ids, async (id) => {
        const res = await fetch(`/api/media/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        if ((await res.json()).success) {
          setMedia((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } as Media : m))
        }
      })
    } catch {}
    finally {
      setProcessing(null)
      setSelected(new Set())
    }
  }

  const batchApprove = () => batchUpdate({ approved: true })
  const batchHide = () => batchUpdate({ status: 'hidden' })

  const batchDelete = () => batchUpdate({ status: 'deleted', displayState: 'masked' })

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">媒體管理</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            共 {filtered.length} 個項目 · 拖曳卡片可調整投放順序
            {savingOrder && <span className="text-[#c9a84c] ml-2">順序儲存中…</span>}
          </p>
        </div>
      </div>

      {/* State filter — one tap per state, with live counts */}
      <div className="bg-white rounded-2xl border border-gray-200 p-2 mb-3 flex flex-wrap gap-1">
        {([
          { st: 'all',     label: '全部', icon: '' },
          { st: 'pinned',  label: '置頂', icon: '📌' },
          { st: 'playing', label: '播放', icon: '▶️' },
          { st: 'pending', label: '待播', icon: '⏳' },
          { st: 'masked',  label: '遮蔽', icon: '⬜' },
          { st: 'deleted', label: '刪除', icon: '❌' },
        ] as { st: typeof filter.state; label: string; icon: string }[]).map((t) => (
          <button
            key={t.st}
            onClick={() => setFilter((f) => ({ ...f, state: t.st }))}
            className={`flex-1 min-w-20 px-3 py-2 rounded-xl text-sm transition-colors ${
              filter.state === t.st
                ? 'bg-[#c9a84c] text-white font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.icon && <span className="mr-1">{t.icon}</span>}{t.label}
            <span className={`ml-1.5 text-xs ${filter.state === t.st ? 'text-white/70' : 'text-gray-400'}`}>
              {counts[t.st]}
            </span>
          </button>
        ))}
      </div>

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="bg-[#c9a84c]/10 border border-[#c9a84c]/30 rounded-xl p-3 mb-4 flex items-center gap-3">
          <span className="text-sm text-[#7a5c2e]">已選 {selected.size} 項</span>
          <button onClick={batchApprove} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600">批次通過</button>
          <button onClick={batchHide} className="text-xs bg-gray-500 text-white px-3 py-1.5 rounded-lg hover:bg-gray-600">批次隱藏</button>
          <button onClick={batchDelete} className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600">批次刪除</button>
          <span className="text-xs text-gray-400">（移到「刪除」，雲端檔案保留）</span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700 ml-auto">取消</button>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p>沒有符合的媒體</p>
        </div>
      ) : (
        <div>
          {/* Select all */}
          <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={selectAll}
              className="accent-[#c9a84c]"
            />
            全選
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.slice(0, visibleCount).map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                draggable
                isDragging={dragId === item.id}
                isDragOver={dragOverId === item.id}
                onDragStart={() => setDragId(item.id)}
                onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                onDragOver={() => setDragOverId(item.id)}
                onDrop={() => handleDrop(item.id)}
                selected={selected.has(item.id)}
                processing={processing === item.id || processing === 'batch'}
                onSelect={() => toggleSelect(item.id)}
                onPreview={() => setPreview(item)}
                realName={realNames[item.guestId]}
                onApprove={() => updateMedia(item.id, { approved: !item.approved })}
                onHide={() => updateMedia(item.id, { status: item.status === 'hidden' ? 'active' : 'hidden' })}
                onDelete={() => trashMedia(item.id)}
                onRestore={() => restoreMedia(item.id)}
                onPurge={() => purgeMedia(item.id)}
                onSetState={(st) => updateMedia(item.id, { displayState: st, displayError: false })}
              />
            ))}
          </div>

          {/* Load more — keeps DOM light with hundreds of items */}
          {filtered.length > visibleCount && (
            <div className="text-center mt-6">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="px-6 py-2.5 rounded-xl text-sm bg-white border border-gray-300 text-gray-600 hover:border-[#c9a84c] hover:text-[#7a5c2e] transition-colors"
              >
                載入更多（還有 {filtered.length - visibleCount} 個）
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button className="absolute top-4 right-4 text-white text-3xl leading-none" onClick={() => setPreview(null)}>×</button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-3xl w-full">
            {/* Media preview */}
            {preview.fileType === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://lh3.googleusercontent.com/d/${preview.googleDriveFileId}=w1920`}
                alt={preview.fileName}
                className="max-w-full max-h-[65vh] object-contain rounded-xl mx-auto block"
                onError={(e) => {
                  const img = e.target as HTMLImageElement
                  if (!img.src.includes('thumbnail')) {
                    img.src = `https://drive.google.com/thumbnail?id=${preview.googleDriveFileId}&sz=w1920`
                  }
                }}
              />
            ) : (
              <video
                src={`/api/video/${preview.googleDriveFileId}`}
                controls
                playsInline
                className="max-w-full max-h-[65vh] object-contain rounded-xl mx-auto block"
              />
            )}

            {/* Info */}
            <div className="text-white text-sm text-center mt-3 space-y-1">
              <p className="font-medium">
                {withRealName(preview.guestName, realNames[preview.guestId])}
              </p>
              <p className="opacity-60">{preview.fileName}</p>
              <p className="opacity-40 text-xs">
                {(preview.fileSize / 1024 / 1024).toFixed(1)} MB ·{' '}
                {new Date(preview.uploadTime).toLocaleString('zh-TW')}
              </p>
              <a
                href={preview.googleDriveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#c9a84c] text-xs hover:underline"
              >
                在 Google Drive 中查看 →
              </a>
            </div>

            {/* Carousel state — same five controls as the card */}
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {([
                { st: 'pinned',  icon: '📌', label: '置頂' },
                { st: 'playing', icon: '▶️', label: '播放' },
                { st: 'pending', icon: '⏳', label: '待播' },
                { st: 'masked',  icon: '⬜', label: '遮蔽' },
              ] as { st: DisplayState; icon: string; label: string }[]).map((b) => {
                const isCurrent = (preview.displayState ?? 'pending') === b.st
                return (
                  <button
                    key={b.st}
                    onClick={() => {
                      if (isCurrent) return
                      updateMedia(preview.id, { displayState: b.st, displayError: false })
                      setPreview((p) => p ? { ...p, displayState: b.st, displayError: false } : null)
                    }}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      isCurrent
                        ? 'bg-[#c9a84c] text-white'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {b.icon} {b.label}
                  </button>
                )
              })}
              <button
                onClick={() => { trashMedia(preview.id); setPreview(null) }}
                title="移到「刪除」，雲端檔案保留"
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors"
              >
                ❌ 刪除
              </button>
            </div>

            {/* Approval is separate from where the photo sits in the carousel */}
            <div className="flex justify-center mt-2">
              <button
                onClick={() => {
                  updateMedia(preview.id, { approved: !preview.approved })
                  setPreview((p) => p ? { ...p, approved: !p.approved } : null)
                }}
                className="px-4 py-1.5 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                {preview.approved ? '取消審核通過' : '✓ 審核通過'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MediaCard({
  realName,
  item,
  selected,
  processing,
  onSelect,
  onPreview,
  onApprove,
  onHide,
  onDelete,
  onRestore,
  onPurge,
  onSetState,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  item: Media
  selected: boolean
  processing: boolean
  onSelect: () => void
  onPreview: () => void
  realName?: string
  onApprove: () => void
  onHide: () => void
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
  onSetState: (s: DisplayState) => void
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragOver?: () => void
  onDrop?: () => void
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.() }}
      onDrop={(e) => { e.preventDefault(); onDrop?.() }}
      className={`relative bg-white rounded-xl border-2 transition-all overflow-hidden ${
        isDragOver ? 'border-[#c9a84c] ring-2 ring-[#c9a84c]/40 scale-[1.02]'
        : selected ? 'border-[#c9a84c]' : 'border-gray-200'
      } ${processing ? 'opacity-50' : ''} ${isDragging ? 'opacity-40' : ''} ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        className="absolute top-2 left-2 z-10 accent-[#c9a84c] w-4 h-4"
      />

      {/* Thumbnail */}
      <div className="aspect-square cursor-pointer relative" onClick={onPreview}>
        {item.fileType === 'photo' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt={item.guestName}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full relative bg-gray-800">
            {/* Drive generates video thumbnails; fall back to the clapper icon */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnailUrl}
              alt={item.guestName}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl drop-shadow-lg">▶️</span>
            </div>
          </div>
        )}
        {item.status === 'hidden' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white text-xs">已隱藏</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="text-xs font-medium text-gray-700 truncate">
          {withRealName(item.guestName, realName)}
        </p>
        <p className="text-xs text-gray-400 truncate">{item.fileName}</p>

        {/* Status badges */}
        <div className="flex gap-1 mt-1 flex-wrap">
          {item.approved ? (
            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">已通過</span>
          ) : (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">待審核</span>
          )}
          {item.displayError && (
            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">🚨 投放異常</span>
          )}
        </div>

        {/* A trashed photo has no place in the carousel yet — offer the two
            ways out instead of five states it can't be in. */}
        {item.status === 'deleted' ? (
          <div className="grid grid-cols-2 gap-1 mt-2">
            <button
              onClick={onRestore}
              className="text-[10px] py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors leading-tight"
            >
              <span className="block text-xs">↩️</span>
              復原
            </button>
            <button
              onClick={onPurge}
              title="連同 Google Drive 檔案一起刪除"
              className="text-[10px] py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors leading-tight"
            >
              <span className="block text-xs">🗑️</span>
              永久刪除
            </button>
          </div>
        ) : (
        <div className="grid grid-cols-5 gap-1 mt-2">
          {([
            { st: 'pinned',  icon: '📌', label: '置頂' },
            { st: 'playing', icon: '▶️', label: '播放' },
            { st: 'pending', icon: '⏳', label: '待播' },
            { st: 'masked',  icon: '⬜', label: '遮蔽' },
          ] as { st: DisplayState; icon: string; label: string }[]).map((b) => {
            const activeState = (item.displayState ?? 'pending') === b.st
            return (
              <button
                key={b.st}
                onClick={() => !activeState && onSetState(b.st)}
                title={b.label}
                className={`text-[10px] py-1 rounded-lg transition-colors leading-tight ${
                  activeState
                    ? 'bg-[#c9a84c] text-white font-medium'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                <span className="block text-xs">{b.icon}</span>
                {b.label}
              </button>
            )
          })}
          <button
            onClick={onDelete}
            title="移到「刪除」，雲端檔案保留"
            className="text-[10px] py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors leading-tight"
          >
            <span className="block text-xs">❌</span>
            刪除
          </button>
        </div>
        )}

        {/* Approval stays separate from carousel state */}
        <button
          onClick={onApprove}
          className={`w-full mt-1 text-xs py-1 rounded-lg transition-colors ${
            item.approved
              ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              : 'bg-green-100 text-green-700 hover:bg-green-200'
          }`}
        >
          {item.approved ? '取消審核通過' : '審核通過'}
        </button>
      </div>
    </div>
  )
}

export default function MediaPage() {
  return (
    <Suspense fallback={<div className="text-center py-16 text-gray-400">載入中...</div>}>
      <MediaPageContent />
    </Suspense>
  )
}
