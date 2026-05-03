'use client'

import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Media } from '@/types'

interface Props {
  guestId: string
}

// After this many seconds, a still-pending video is considered stuck
// (Vercel function was silently killed before writing an error status)
const STUCK_TIMEOUT_SEC = 60

export default function MyUploads({ guestId }: Props) {
  const [media, setMedia] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [preview, setPreview] = useState<Media | null>(null)
  // Ticks every 15 s so stuck-video detection re-evaluates without waiting for user interaction
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  // Real-time listener — updates immediately after upload or hide
  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'media'),
      where('guestId', '==', guestId)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => d.data() as Media)
        const active = all
          .filter((m) => m.status === 'active')
          .sort((a, b) => b.uploadTime.localeCompare(a.uploadTime))
        setMedia(active)
        setLoading(false)
      },
      () => { setLoading(false) }
    )
    return () => unsub()
  }, [guestId])

  const handleDelete = async (id: string) => {
    if (!confirm('確定要移除這個檔案嗎？\n（檔案仍會保留在雲端，主辦人可查看）')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/media/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, status: 'hidden' }),
      })
      if (!(await res.json()).success) {
        alert('移除失敗，請稍後再試')
      }
    } catch {}
    finally { setDeleting(null) }
  }

  const retryTranscript = async (id: string) => {
    setRetrying(id)
    try {
      await fetch(`/api/media/${id}/transcribe`, { method: 'POST' })
    } catch {}
    finally { setRetrying(null) }
  }

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="text-2xl animate-spin inline-block mb-2">⏳</div>
        <p className="text-sm text-gray-400">載入中...</p>
      </div>
    )
  }

  if (media.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-sm text-gray-400">您還沒有上傳任何內容</p>
        <p className="text-xs text-gray-300 mt-1">快去上傳照片吧！</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-serif text-[#7a5c2e]">我的上傳</h2>
        <span className="text-xs text-gray-400">{media.length} 個檔案</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {media.map((item) => {
          // Detect stuck-pending: still pending after STUCK_TIMEOUT_SEC seconds
          const elapsedSec = (Date.now() - new Date(item.uploadTime).getTime()) / 1000
          const isStuck = item.fileType === 'video'
            && item.transcriptStatus === 'pending'
            && elapsedSec > STUCK_TIMEOUT_SEC
          const needsRetry = item.fileType === 'video'
            && (item.transcriptStatus === 'error' || isStuck)
          const isPending = item.fileType === 'video'
            && item.transcriptStatus === 'pending'
            && !isStuck

          return (
            <div
              key={item.id}
              className="relative aspect-square bg-gray-100 rounded-xl overflow-hidden group"
            >
              {item.fileType === 'photo' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://lh3.googleusercontent.com/d/${item.googleDriveFileId}=w400`}
                  alt={item.fileName}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setPreview(item)}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement
                    if (!img.src.includes('uc?export')) {
                      img.src = `https://drive.google.com/uc?export=view&id=${item.googleDriveFileId}`
                    }
                  }}
                />
              ) : (
                <div
                  className="w-full h-full flex flex-col items-center justify-center bg-gray-800 cursor-pointer"
                  onClick={() => setPreview(item)}
                >
                  <span className="text-2xl">🎬</span>
                  <span className="text-xs text-white mt-1 px-1 truncate w-full text-center">
                    {item.fileName.split('.').pop()?.toUpperCase()}
                  </span>
                </div>
              )}

              {/* Status badges */}
              <div className="absolute top-1 left-1 flex flex-col gap-0.5">
                {!item.approved && (
                  <div className="bg-yellow-500/90 text-white text-xs px-1.5 py-0.5 rounded">
                    審核中
                  </div>
                )}

                {/* Transcript status */}
                {isPending && (
                  <div className="bg-blue-500/90 text-white text-xs px-1.5 py-0.5 rounded animate-pulse">
                    字幕生成中
                  </div>
                )}
                {needsRetry && (
                  <button
                    disabled={retrying === item.id}
                    onClick={(e) => { e.stopPropagation(); retryTranscript(item.id) }}
                    className="bg-orange-500/90 hover:bg-orange-600 active:bg-orange-700 text-white text-xs px-1.5 py-0.5 rounded transition-colors"
                  >
                    {retrying === item.id ? '重試中…' : '字幕失敗・重試'}
                  </button>
                )}
              </div>

              {/* Delete button */}
              <button
                onClick={() => handleDelete(item.id)}
                disabled={deleting === item.id}
                className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors opacity-0 group-hover:opacity-100"
              >
                {deleting === item.id ? '...' : '×'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button
            className="absolute top-4 right-4 text-white text-2xl hover:text-gray-300"
            onClick={() => setPreview(null)}
          >
            ×
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-full">
            {preview.fileType === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://drive.google.com/uc?export=view&id=${preview.googleDriveFileId}`}
                alt={preview.fileName}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            ) : (
              <video
                src={`https://drive.google.com/uc?export=download&id=${preview.googleDriveFileId}`}
                controls
                className="max-w-full max-h-[80vh] rounded-lg"
              />
            )}
            <p className="text-white text-center text-sm mt-2 opacity-70">
              {new Date(preview.uploadTime).toLocaleString('zh-TW')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
