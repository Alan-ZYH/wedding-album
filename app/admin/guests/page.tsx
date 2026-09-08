'use client'

import { useState, useEffect, useCallback } from 'react'
import { collection, onSnapshot, query, limit, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Guest, Media, Message, NameChange } from '@/types'

export default function GuestsPage() {
  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // The `guests` collection is admin-only, so it is read through the API
  // (Admin SDK) rather than the browser SDK, which Firestore rules block.
  // Polling keeps it near-live without opening the collection to clients.
  const loadGuests = useCallback(async () => {
    try {
      const res = await fetch('/api/guests')
      const data = await res.json()
      if (data.success) setGuests(data.data as Guest[])
    } catch { /* keep the previous list */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    loadGuests()
    const t = setInterval(loadGuests, 10_000)
    return () => clearInterval(t)
  }, [loadGuests])

  const toggleBlock = async (guest: Guest) => {
    const next = !guest.blocked
    if (next && !confirm(
      `確定封鎖「${guest.guestName}」${guest.realName ? `（${guest.realName}）` : ''}？\n\n` +
      `• 他將無法再上傳照片或祝福\n` +
      `• 他已上傳的 ${guest.photoCount ?? 0} 張照片會全部設為「已遮蔽」\n` +
      `• 他的 ${guest.messageCount ?? 0} 則祝福會全部隱藏`
    )) return

    setProcessing(guest.guestId)
    try {
      const res = await fetch(`/api/guests/${guest.guestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: next }),
      })
      const data = await res.json()
      await loadGuests()
      if (data.success && next) {
        alert(`已封鎖。遮蔽 ${data.maskedPhotos} 張照片、隱藏 ${data.hiddenMessages} 則祝福。`)
      } else if (!data.success) {
        alert(data.error || '操作失敗')
      }
    } catch { alert('網路錯誤，請重試') }
    finally { setProcessing(null) }
  }

  /**
   * Removing a guest is the harsher neighbour of blocking: they leave the
   * list, and everything they contributed lands in the 刪除 columns. Nothing is
   * erased — the Drive files survive, so 媒體管理 can still bring a photo back.
   */
  const deleteGuest = async (guest: Guest) => {
    if (!confirm(
      `確定刪除「${guest.guestName}」${guest.realName ? `（${guest.realName}）` : ''}？\n\n` +
      `• 從賓客清單移除\n` +
      `• 他的 ${guest.photoCount ?? 0} 張照片移入「刪除」（雲端檔案保留，可從媒體管理復原）\n` +
      `• 他的 ${guest.messageCount ?? 0} 則祝福移入「刪除」`
    )) return

    setProcessing(guest.guestId)
    try {
      const res = await fetch(`/api/guests/${guest.guestId}`, { method: 'DELETE' })
      const data = await res.json()
      await loadGuests()
      if (data.success) {
        setExpanded((e) => (e === guest.guestId ? null : e))
        alert(`已刪除。照片 ${data.deletedPhotos} 張、祝福 ${data.deletedMessages} 則移入「刪除」。`)
      } else {
        alert(data.error || '操作失敗')
      }
    } catch { alert('網路錯誤，請重試') }
    finally { setProcessing(null) }
  }

  const filtered = guests.filter((g) => {
    if (!search) return true
    const q = search.toLowerCase()
    // Searching the real name is the point of storing it — the couple knows
    // who came, not what screen name they picked.
    return g.guestName.toLowerCase().includes(q) || (g.realName ?? '').toLowerCase().includes(q)
  })
  const blockedCount = guests.filter((g) => g.blocked).length

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-serif text-gray-800">賓客管理</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          共 {guests.length} 位賓客
          {blockedCount > 0 && <span className="text-red-500"> · {blockedCount} 位已封鎖</span>}
        </p>
      </div>

      <input
        type="text"
        placeholder="搜尋本名或投影顯示名稱..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c] mb-4"
      />

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">👥</div>
          <p>{guests.length === 0 ? '尚無賓客上傳內容' : '沒有符合的賓客'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {filtered.map((g, i) => (
            <div key={g.guestId} className={i > 0 ? 'border-t border-gray-100' : ''}>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <div className="flex-1 min-w-[55%] sm:min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">
                    {g.guestName}
                    <span className="text-gray-300 font-mono text-xs ml-1.5">
                      #{g.guestId.slice(0, 4)}
                    </span>
                    {g.blocked && (
                      <span className="ml-2 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">
                        🚫 已封鎖
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    本名：{g.realName
                      ? <span className="text-gray-700">{g.realName}</span>
                      : <span className="text-gray-300">未填寫</span>}
                    {(g.nameHistory?.length ?? 0) > 0 && (
                      <span className="ml-2 text-[#c9a84c]">✎ 改過 {g.nameHistory!.length} 次</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    📷 {g.photoCount ?? 0} · 💌 {g.messageCount ?? 0} · {timeAgo(g.lastActiveAt)}
                  </p>
                </div>
                <button
                  onClick={() => setExpanded(expanded === g.guestId ? null : g.guestId)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  {expanded === g.guestId ? '收合' : '查看'}
                </button>
                <button
                  onClick={() => toggleBlock(g)}
                  disabled={processing === g.guestId}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    processing === g.guestId
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : g.blocked
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-red-50 text-red-500 hover:bg-red-100'
                  }`}
                >
                  {processing === g.guestId ? '處理中' : g.blocked ? '解除封鎖' : '封鎖'}
                </button>
                <button
                  onClick={() => deleteGuest(g)}
                  disabled={processing === g.guestId}
                  title="從清單移除，照片與祝福移入「刪除」"
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    processing === g.guestId
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
                >
                  刪除
                </button>
              </div>
              {expanded === g.guestId && <GuestDetail guest={g} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GuestDetail({ guest }: { guest: Guest }) {
  const guestId = guest.guestId
  const [media, setMedia] = useState<Media[]>([])
  const [messages, setMessages] = useState<Message[]>([])

  useEffect(() => {
    if (!db) return
    const unsubM = onSnapshot(
      query(collection(db, 'media'), where('guestId', '==', guestId), limit(200)),
      (snap) => setMedia(
        snap.docs.map((d) => d.data() as Media)
          .sort((a, b) => b.uploadTime.localeCompare(a.uploadTime))
      ),
      () => {}
    )
    const unsubMsg = onSnapshot(
      query(collection(db, 'messages'), where('guestId', '==', guestId), limit(200)),
      (snap) => setMessages(
        snap.docs.map((d) => d.data() as Message)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      ),
      () => {}
    )
    return () => { unsubM(); unsubMsg() }
  }, [guestId])

  return (
    <div className="bg-gray-50 px-4 py-4 border-t border-gray-100">
      {/* Names ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-4 max-w-md">
        <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
          <p className="text-[10px] text-gray-400">本名</p>
          <p className="text-sm text-gray-700">{guest.realName || '未填寫'}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
          <p className="text-[10px] text-gray-400">投影顯示名稱</p>
          <p className="text-sm text-gray-700">{guest.guestName}</p>
        </div>
      </div>

      <p className="text-xs font-medium text-gray-500 mb-2">
        名稱修改紀錄（{guest.nameHistory?.length ?? 0}）
      </p>
      {!guest.nameHistory?.length ? (
        <p className="text-xs text-gray-400 mb-4">未曾修改</p>
      ) : (
        <div className="space-y-1 mb-4">
          {[...guest.nameHistory].reverse().map((c: NameChange, i) => (
            <div key={i} className="text-xs bg-white rounded-lg px-3 py-1.5 border border-gray-200 flex flex-wrap items-center gap-x-2">
              <span className="text-gray-400">
                {c.field === 'realName' ? '本名' : '投影顯示名稱'}
              </span>
              <span className="text-gray-400 line-through">{c.from}</span>
              <span className="text-gray-300">→</span>
              <span className="text-gray-700">{c.to}</span>
              <span className="text-gray-300 ml-auto">{timeAgo(c.at)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs font-medium text-gray-500 mb-2">照片 / 影片（{media.length}）</p>
      {media.length === 0 ? (
        <p className="text-xs text-gray-400 mb-4">無</p>
      ) : (
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 mb-4">
          {media.map((m) => (
            <div key={m.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumbnailUrl} alt={m.fileName} loading="lazy" className="w-full h-full object-cover" />
              {m.fileType === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center text-lg drop-shadow">▶️</span>
              )}
              <span className="absolute bottom-0 inset-x-0 text-[9px] text-center bg-black/60 text-white py-0.5">
                {stateLabel(m.displayState)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs font-medium text-gray-500 mb-2">祝福（{messages.length}）</p>
      {messages.length === 0 ? (
        <p className="text-xs text-gray-400">無</p>
      ) : (
        <div className="space-y-1.5">
          {messages.map((m) => (
            <div key={m.id} className="text-xs bg-white rounded-lg px-3 py-2 border border-gray-200">
              <span className={m.status !== 'active' ? 'text-gray-400 line-through' : 'text-gray-700'}>
                {m.message}
              </span>
              <span className="text-gray-300 ml-2">{timeAgo(m.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function stateLabel(s?: string) {
  return s === 'pinned' ? '📌 置頂'
    : s === 'playing' ? '▶️ 播放中'
    : s === 'pending' ? '⏳ 待播'
    : s === 'masked' ? '⬜ 遮蔽'
    : '—'
}

function timeAgo(iso?: string) {
  if (!iso) return '—'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return '剛剛'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  return new Date(iso).toLocaleDateString('zh-TW')
}
