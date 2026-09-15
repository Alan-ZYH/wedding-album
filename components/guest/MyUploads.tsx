'use client'

import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Media, Message, AlbumItem } from '@/types'

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
  const [albumItems, setAlbumItems] = useState<AlbumItem[]>([])
  const [albumPreview, setAlbumPreview] = useState<AlbumItem | null>(null)
  const [projecting, setProjecting] = useState<string | null>(null)
  const [toast, setToast] = useState('')

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

  // What they kept for the couple. The album collection is closed to browsers,
  // so it comes through the API; polled, since a snapshot listener cannot reach it.
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`/api/album/mine?guestId=${encodeURIComponent(guestId)}`)
        .then((r) => r.json())
        .then((d) => { if (alive && d.success) setAlbumItems(d.data) })
        .catch(() => {})
    load()
    const t = setInterval(load, 20_000)
    return () => { alive = false; clearInterval(t) }
  }, [guestId])

  const removeAlbumItem = async (id: string) => {
    if (!confirm('確定要從新人相簿移除這個檔案嗎？')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/album/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, status: 'deleted' }),
      })
      if ((await res.json()).success) setAlbumItems((prev) => prev.filter((a) => a.id !== id))
      else alert('移除失敗，請稍後再試')
    } catch {}
    finally { setDeleting(null) }
  }

  /**
   * 投影: send one of their own photos to the screen queue — one that already
   * played, or one they had kept for the couple. The server treats it as
   * sending a photo: it spends the cooldown and honours the switches.
   */
  const project = async (id: string, fromAlbum: boolean) => {
    setProjecting(id)
    try {
      const res = await fetch('/api/guest/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, id }),
      })
      const d = await res.json()
      if (d.success) {
        // A kept photo now lives with the projection photos, which the live
        // listener brings in; drop it from the album list at once
        if (fromAlbum) setAlbumItems((prev) => prev.filter((a) => a.id !== id))
        setToast('已排入大螢幕，稍後就會播放 📺')
      } else {
        setToast(d.error || '投影失敗，請稍後再試')
      }
    } catch {
      setToast('網路錯誤，請稍後再試')
    } finally {
      setProjecting(null)
      setTimeout(() => setToast(''), 3500)
    }
  }

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

  if (media.length === 0 && messages.length === 0 && albumItems.length === 0) {
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
          {media.length} 張投影 · {albumItems.length} 個存相簿 · {messages.length} 則祝福
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

            {/* Where it is on the screen */}
            {!item.approved ? (
              <div className="absolute top-1 left-1 bg-yellow-500/90 text-white text-[10px] px-1.5 py-0.5 rounded">審核中</div>
            ) : (
              <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none">
                {item.displayState === 'playing' ? '▶️ 播放中'
                  : item.displayState === 'pinned' ? '📌 置頂'
                  : item.displayState === 'pending' ? '⏳ 排隊中'
                  : item.maskedBy === 'rotation' ? '已播過'
                  : '暫停投影'}
              </div>
            )}

            {/* Actions — always visible: hover-reveal is invisible on phones,
                which is the only device most guests will ever use this on. */}
            <div className="absolute bottom-1.5 inset-x-1.5 flex justify-end gap-1">
              {item.fileType === 'photo' && item.displayState === 'masked' && item.maskedBy === 'rotation' && (
                <button
                  onClick={() => project(item.id, false)}
                  disabled={projecting === item.id}
                  aria-label="再次投影到大螢幕"
                  className="bg-[#c9a84c] hover:bg-[#b8953d] text-white rounded-lg px-2 py-1 flex items-center gap-1 text-xs shadow-lg transition-colors"
                >
                  {projecting === item.id ? '…' : <><span>📺</span><span>投影</span></>}
                </button>
              )}
              <button
                onClick={() => handleDelete(item.id)}
                disabled={deleting === item.id}
                aria-label="移除這個檔案"
                className="bg-black/70 hover:bg-red-600 active:bg-red-600 text-white rounded-lg px-2 py-1 flex items-center gap-1 text-xs shadow-lg transition-colors"
              >
                {deleting === item.id ? '移除中' : <><span>🗑</span><span>移除</span></>}
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Kept for the couple — never on the screen */}
      {albumItems.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-600 mb-3">💝 存入新人相簿</h3>
          <div className="grid grid-cols-3 gap-2">
            {albumItems.map((item) => (
              <div key={item.id} className="relative aspect-square bg-gray-800 rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt={item.fileName}
                  loading="lazy"
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setAlbumPreview(item)}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                />
                {item.fileType === 'video' && (
                  <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none">▶ 影片</span>
                )}
                <div className="absolute bottom-1.5 inset-x-1.5 flex justify-end gap-1">
                  {item.fileType === 'photo' && (
                    <button
                      onClick={() => project(item.id, true)}
                      disabled={projecting === item.id}
                      aria-label="改為投影到大螢幕"
                      className="bg-[#c9a84c] hover:bg-[#b8953d] text-white rounded-lg px-2 py-1 flex items-center gap-1 text-xs shadow-lg transition-colors"
                    >
                      {projecting === item.id ? '…' : <><span>📺</span><span>投影</span></>}
                    </button>
                  )}
                  <button
                    onClick={() => removeAlbumItem(item.id)}
                    disabled={deleting === item.id}
                    aria-label="從相簿移除"
                    className="bg-black/70 hover:bg-red-600 active:bg-red-600 text-white rounded-lg px-2 py-1 flex items-center gap-1 text-xs shadow-lg transition-colors"
                  >
                    {deleting === item.id ? '移除中' : <><span>🗑</span><span>移除</span></>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {albumPreview && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setAlbumPreview(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl" onClick={() => setAlbumPreview(null)}>×</button>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
            {albumPreview.fileType === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://lh3.googleusercontent.com/d/${albumPreview.googleDriveFileId}=w1920`}
                alt={albumPreview.fileName}
                className="max-w-full max-h-[80vh] object-contain rounded-lg mx-auto"
              />
            ) : (
              <iframe
                src={`https://drive.google.com/file/d/${albumPreview.googleDriveFileId}/preview`}
                allow="autoplay"
                className="w-full aspect-video rounded-lg bg-black"
              />
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 inset-x-4 z-40 flex justify-center pointer-events-none">
          <div className="bg-gray-900/90 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
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
