'use client'

import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Media, Message } from '@/types'

interface Props {
  guestId: string
}

export default function MyUploads({ guestId }: Props) {
  const [media, setMedia] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [preview, setPreview] = useState<Media | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [msgBusy, setMsgBusy] = useState<string | null>(null)

  // Real-time listener — updates immediately after upload or hide
  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'media'),
      where('guestId', '==', guestId),
      limit(100)
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

  // The guest's own blessings, managed alongside their photos so there is one
  // place to review everything they contributed.
  useEffect(() => {
    if (!db) return
    const q = query(collection(db, 'messages'), where('guestId', '==', guestId), limit(100))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(
          snap.docs
            .map((d) => d.data() as Message)
            .filter((m) => m.status === 'active')
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        )
      },
      () => {}
    )
    return () => unsub()
  }, [guestId])

  const saveMessage = async (id: string) => {
    const trimmed = editText.trim()
    if (!trimmed) return
    setMsgBusy(id)
    try {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, message: trimmed }),
      })
      setEditingId(null)
    } catch {}
    finally { setMsgBusy(null) }
  }

  const deleteMessage = async (id: string) => {
    if (!confirm('確定要刪除這則祝福嗎？')) return
    setMsgBusy(id)
    try {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, status: 'deleted' }),
      })
    } catch {}
    finally { setMsgBusy(null) }
  }

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

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="text-2xl animate-spin inline-block mb-2">⏳</div>
        <p className="text-sm text-gray-400">載入中...</p>
      </div>
    )
  }

  if (media.length === 0 && messages.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-sm text-gray-400">您還沒有上傳任何內容</p>
        <p className="text-xs text-gray-300 mt-1">快去上傳照片或送上祝福吧！</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-serif text-[#7a5c2e]">我的上傳</h2>
        <span className="text-xs text-gray-400">
          {media.length} 個檔案 · {messages.length} 則祝福
        </span>
      </div>

      {media.length > 0 && (
      <div className="grid grid-cols-3 gap-2">
        {media.map((item) => (
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
                  if (!img.src.includes('thumbnail')) {
                    img.src = `https://drive.google.com/thumbnail?id=${item.googleDriveFileId}&sz=w400`
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

            {/* Approval badge */}
            {!item.approved && (
              <div className="absolute top-1 left-1 bg-yellow-500/90 text-white text-xs px-1.5 py-0.5 rounded">
                審核中
              </div>
            )}

            {/* Delete button */}
            <button
              onClick={() => handleDelete(item.id)}
              disabled={deleting === item.id}
              className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors opacity-0 group-hover:opacity-100"
            >
              {deleting === item.id ? '...' : '×'}
            </button>
          </div>
        ))}
      </div>
      )}

      {/* My blessings — editable in the same place as the photos */}
      {messages.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-600 mb-3">我的祝福</h3>
          <div className="space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className="bg-white rounded-xl border border-[#e8d5a3] p-3">
                {editingId === msg.id ? (
                  <>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="w-full resize-none text-sm border border-[#e8d5a3] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#c9a84c]"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => saveMessage(msg.id)}
                        disabled={msgBusy === msg.id || !editText.trim()}
                        className="text-xs bg-[#c9a84c] hover:bg-[#b8953d] disabled:bg-gray-200 disabled:text-gray-400 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {msgBusy === msg.id ? '儲存中...' : '儲存'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                      {msg.message}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-gray-300 flex-1">
                        {new Date(msg.createdAt).toLocaleString('zh-TW')}
                      </span>
                      <button
                        onClick={() => { setEditingId(msg.id); setEditText(msg.message) }}
                        className="text-xs text-[#c9a84c] hover:underline"
                      >
                        修改
                      </button>
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        disabled={msgBusy === msg.id}
                        className="text-xs text-red-400 hover:text-red-600 hover:underline"
                      >
                        {msgBusy === msg.id ? '...' : '刪除'}
                      </button>
                    </div>
                  </>
                )}
              </div>
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
                src={`https://lh3.googleusercontent.com/d/${preview.googleDriveFileId}=w1920`}
                alt={preview.fileName}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            ) : (
              <video
                src={`https://lh3.googleusercontent.com/d/${preview.googleDriveFileId}`}
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
