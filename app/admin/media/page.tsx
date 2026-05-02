'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Media } from '@/types'

function MediaPageContent() {
  const searchParams = useSearchParams()
  const [media, setMedia] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState({
    type: searchParams.get('type') || 'all',
    pending: searchParams.get('pending') === 'true',
    search: '',
  })
  const [preview, setPreview] = useState<Media | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)

  const fetchMedia = useCallback(async () => {
    try {
      const res = await fetch('/api/media')
      const data = await res.json()
      if (data.success) setMedia(data.data)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchMedia() }, [fetchMedia])

  const filtered = media.filter((m) => {
    if (m.status === 'deleted') return false
    if (filter.type !== 'all' && m.fileType !== filter.type) return false
    if (filter.pending && m.approved) return false
    if (filter.search) {
      const s = filter.search.toLowerCase()
      if (!m.guestName.toLowerCase().includes(s) && !m.fileName.toLowerCase().includes(s)) return false
    }
    return true
  })

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

  const deleteMedia = async (id: string) => {
    if (!confirm('確定永久刪除？此操作也會刪除 Google Drive 中的檔案。')) return
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

  const batchApprove = async () => {
    for (const id of selected) {
      await updateMedia(id, { approved: true })
    }
    setSelected(new Set())
  }

  const batchHide = async () => {
    for (const id of selected) {
      await updateMedia(id, { status: 'hidden' })
    }
    setSelected(new Set())
  }

  const batchDelete = async () => {
    if (!confirm(`確定永久刪除 ${selected.size} 個檔案？`)) return
    for (const id of selected) {
      await deleteMedia(id)
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">媒體管理</h1>
          <p className="text-sm text-gray-400 mt-0.5">共 {filtered.length} 個項目</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="搜尋名稱或檔案名..."
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c] flex-1 min-w-40"
        />
        <select
          value={filter.type}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none"
        >
          <option value="all">全部類型</option>
          <option value="photo">照片</option>
          <option value="video">影片</option>
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={filter.pending}
            onChange={(e) => setFilter((f) => ({ ...f, pending: e.target.checked }))}
            className="accent-[#c9a84c]"
          />
          僅顯示待審核
        </label>
      </div>

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="bg-[#c9a84c]/10 border border-[#c9a84c]/30 rounded-xl p-3 mb-4 flex items-center gap-3">
          <span className="text-sm text-[#7a5c2e]">已選 {selected.size} 項</span>
          <button onClick={batchApprove} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600">批次通過</button>
          <button onClick={batchHide} className="text-xs bg-gray-500 text-white px-3 py-1.5 rounded-lg hover:bg-gray-600">批次隱藏</button>
          <button onClick={batchDelete} className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600">批次刪除</button>
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
            {filtered.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                processing={processing === item.id}
                onSelect={() => toggleSelect(item.id)}
                onPreview={() => setPreview(item)}
                onApprove={() => updateMedia(item.id, { approved: !item.approved })}
                onHide={() => updateMedia(item.id, { status: item.status === 'hidden' ? 'active' : 'hidden' })}
                onDelete={() => deleteMedia(item.id)}
              />
            ))}
          </div>
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
              <iframe
                src={`https://drive.google.com/file/d/${preview.googleDriveFileId}/preview`}
                allow="autoplay; fullscreen"
                allowFullScreen
                className="w-full rounded-xl mx-auto block"
                style={{ height: '60vh', border: 'none' }}
              />
            )}

            {/* Info */}
            <div className="text-white text-sm text-center mt-3 space-y-1">
              <p className="font-medium">{preview.guestName}</p>
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

            {/* Action buttons inside modal */}
            <div className="flex justify-center gap-3 mt-4">
              <button
                onClick={() => {
                  updateMedia(preview.id, { approved: !preview.approved })
                  setPreview((p) => p ? { ...p, approved: !p.approved } : null)
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  preview.approved
                    ? 'bg-gray-600 hover:bg-gray-500 text-white'
                    : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
              >
                {preview.approved ? '取消通過' : '✓ 通過'}
              </button>
              <button
                onClick={() => {
                  const newStatus = preview.status === 'hidden' ? 'active' : 'hidden'
                  updateMedia(preview.id, { status: newStatus })
                  setPreview((p) => p ? { ...p, status: newStatus } : null)
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-600 hover:bg-gray-500 text-white transition-colors"
              >
                {preview.status === 'hidden' ? '👁 顯示' : '🙈 隱藏'}
              </button>
              <button
                onClick={() => {
                  deleteMedia(preview.id)
                  setPreview(null)
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors"
              >
                🗑 刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MediaCard({
  item,
  selected,
  processing,
  onSelect,
  onPreview,
  onApprove,
  onHide,
  onDelete,
}: {
  item: Media
  selected: boolean
  processing: boolean
  onSelect: () => void
  onPreview: () => void
  onApprove: () => void
  onHide: () => void
  onDelete: () => void
}) {
  return (
    <div className={`relative bg-white rounded-xl border-2 transition-colors overflow-hidden ${
      selected ? 'border-[#c9a84c]' : 'border-gray-200'
    } ${processing ? 'opacity-50' : ''}`}>
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
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800 text-3xl">
            🎬
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
        <p className="text-xs font-medium text-gray-700 truncate">{item.guestName}</p>
        <p className="text-xs text-gray-400 truncate">{item.fileName}</p>

        {/* Status badges */}
        <div className="flex gap-1 mt-1 flex-wrap">
          {item.approved ? (
            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">已通過</span>
          ) : (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">待審核</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 mt-2">
          <button
            onClick={onApprove}
            className={`flex-1 text-xs py-1 rounded-lg transition-colors ${
              item.approved
                ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {item.approved ? '取消' : '通過'}
          </button>
          <button
            onClick={onHide}
            className="flex-1 text-xs py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
          >
            {item.status === 'hidden' ? '顯示' : '隱藏'}
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
          >
            🗑
          </button>
        </div>
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
