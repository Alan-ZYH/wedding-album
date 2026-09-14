'use client'

import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Message, MessageDisplayState, DEFAULT_SETTINGS } from '@/types'
import { useRealNames, withRealName, ADMIN_GUEST_ID } from '@/lib/guest-names'
import BlessingColorPicker from '@/components/admin/BlessingColorPicker'
import { BLESSING_COLORS, DEFAULT_BLESSING_COLOR } from '@/lib/blessing-colors'

type StateFilter = 'all' | MessageDisplayState

const STATE_LABEL: Record<MessageDisplayState, { text: string; className: string }> = {
  pending: { text: '⏳ 待播',   className: 'bg-amber-50 text-amber-700' },
  pinned:  { text: '📌 置頂',   className: 'bg-[#c9a84c]/15 text-[#7a5c2e]' },
  playing: { text: '▶️ 輪播中', className: 'bg-green-50 text-green-700' },
  masked:  { text: '⬜ 已離開', className: 'bg-gray-100 text-gray-500' },
}

// Blessings written before the rotation existed carry no state; they are not
// on screen, which is what 已離開 means
const stateOf = (m: Message): MessageDisplayState => m.displayState ?? 'masked'

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newMsg, setNewMsg] = useState<{ guestName: string; message: string; pinned: boolean; color: string | null }>(
    { guestName: '', message: '', pinned: false, color: DEFAULT_BLESSING_COLOR }
  )
  const [addingNew, setAddingNew] = useState(false)
  const [filter, setFilter] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [size, setSize] = useState(DEFAULT_SETTINGS.messageCarouselSize)

  const realNames = useRealNames(messages.map((m) => m.guestId))

  // Live, like 媒體管理: a blessing posted from the floor should appear here
  // without the couple thinking to reload. Sorting is done in memory because
  // status + createdAt would need a composite index.
  useEffect(() => {
    if (!db) return
    const unsub = onSnapshot(
      query(collection(db, 'messages'), limit(1000)),
      (snap) => {
        setMessages(
          snap.docs.map((d) => d.data() as Message)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        )
        setLoading(false)
      },
      () => setLoading(false)
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data.messageCarouselSize) setSize(d.data.messageCarouselSize) })
      .catch(() => {})
  }, [])

  const visible = messages.filter((m) => m.status !== 'deleted')
  const counts = {
    all: visible.length,
    pending: visible.filter((m) => stateOf(m) === 'pending').length,
    pinned: visible.filter((m) => stateOf(m) === 'pinned').length,
    playing: visible.filter((m) => stateOf(m) === 'playing').length,
    masked: visible.filter((m) => stateOf(m) === 'masked').length,
  }

  const filtered = visible.filter((m) => {
    if (stateFilter !== 'all' && stateOf(m) !== stateFilter) return false
    if (!filter) return true
    const s = filter.toLowerCase()
    return (
      m.guestName.toLowerCase().includes(s) ||
      (realNames[m.guestId] ?? '').toLowerCase().includes(s) ||
      m.message.toLowerCase().includes(s)
    )
  })

  /** Every change goes through the server, which owns the rotation; the live
   *  listener brings the result back, so nothing is patched locally. */
  const send = async (id: string, body: Record<string, unknown>, method = 'PATCH') => {
    setBusy(id)
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PATCH' ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      if (!data.success) alert(data.error || '操作失敗')
      return data.success as boolean
    } catch {
      alert('網路錯誤，請重試')
      return false
    } finally {
      setBusy(null)
    }
  }

  const saveEdit = async (id: string) => {
    if (await send(id, { message: editText })) setEditingId(null)
  }

  const remove = async (id: string) => {
    if (!confirm('確定刪除這則祝福？它會從大螢幕和這個列表消失。')) return
    await send(id, {}, 'DELETE')
  }

  const addMessage = async () => {
    if (!newMsg.message.trim()) return
    setBusy('new')
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: ADMIN_GUEST_ID,
          guestName: newMsg.guestName || '管理員',
          message: newMsg.message,
          fromAdmin: true,
          pinned: newMsg.pinned,
          color: newMsg.color,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setNewMsg((p) => ({ guestName: '', message: '', pinned: false, color: p.color }))
        setAddingNew(false)
      } else {
        alert(data.error || '新增失敗')
      }
    } catch {
      alert('網路錯誤，請重試')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">祝福管理</h1>
          <p className="text-sm text-gray-400">
            大螢幕輪播 {counts.pinned + counts.playing} / {size} 則
            {counts.pinned > 0 && ` · 其中置頂 ${counts.pinned}`}
            {counts.pending > 0 && ` · 待播 ${counts.pending}`}
          </p>
        </div>
        <button
          onClick={() => setAddingNew(!addingNew)}
          className="text-sm bg-[#c9a84c] text-white px-4 py-2 rounded-xl hover:bg-[#b8953d] transition-colors"
        >
          + 新增祝福
        </button>
      </div>

      {/* Add new */}
      {addingNew && (
        <div className="bg-white rounded-2xl border border-[#c9a84c]/30 p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">新增祝福</h3>
          <input
            type="text"
            placeholder="名稱（選填，預設「管理員」）"
            value={newMsg.guestName}
            onChange={(e) => setNewMsg((p) => ({ ...p, guestName: e.target.value }))}
            className="w-full sm:w-64 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c] mb-3"
          />
          <textarea
            placeholder="祝福內容..."
            value={newMsg.message}
            onChange={(e) => setNewMsg((p) => ({ ...p, message: e.target.value }))}
            rows={3}
            maxLength={500}
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c] resize-none"
          />
          <label className="flex items-center gap-2 mt-2 text-sm text-gray-600 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={newMsg.pinned}
              onChange={(e) => setNewMsg((p) => ({ ...p, pinned: e.target.checked }))}
              className="accent-[#c9a84c]"
            />
            📌 置頂（一直留在大螢幕輪播）
          </label>
          <div className="mt-3">
            <BlessingColorPicker
              name={newMsg.guestName || '管理員'}
              color={newMsg.color}
              onChange={(c) => setNewMsg((p) => ({ ...p, color: c }))}
            />
            <p className="text-xs text-gray-400 mt-2">送出後顏色就固定，要換顏色請刪除後重發。</p>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={addMessage}
              disabled={busy === 'new'}
              className="text-sm bg-[#c9a84c] text-white px-4 py-2 rounded-xl hover:bg-[#b8953d] disabled:opacity-50"
            >
              新增
            </button>
            <button onClick={() => setAddingNew(false)} className="text-sm text-gray-500 px-4 py-2 rounded-xl border hover:bg-gray-50">
              取消
            </button>
          </div>
        </div>
      )}

      {/* State filter */}
      <div className="bg-white rounded-2xl border border-gray-200 p-2 mb-3 flex gap-1 overflow-x-auto scrollbar-hide">
        {([
          { st: 'all', label: '全部' },
          { st: 'pinned', label: '📌 置頂' },
          { st: 'playing', label: '▶️ 輪播中' },
          { st: 'pending', label: '⏳ 待播' },
          { st: 'masked', label: '⬜ 已離開' },
        ] as { st: StateFilter; label: string }[]).map((t) => (
          <button
            key={t.st}
            onClick={() => setStateFilter(t.st)}
            className={`shrink-0 whitespace-nowrap flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
              stateFilter === t.st ? 'bg-[#c9a84c] text-white font-medium' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${stateFilter === t.st ? 'text-white/70' : 'text-gray-400'}`}>
              {counts[t.st]}
            </span>
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="搜尋名稱或內容..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a84c] bg-white mb-4"
      />

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">💌</div>
          <p>沒有符合的祝福</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((msg) => {
            const st = stateOf(msg)
            const isBusy = busy === msg.id
            return (
              <div
                key={msg.id}
                className={`bg-white rounded-2xl border p-4 ${st === 'masked' ? 'border-gray-200' : 'border-[#e8d5a3]'}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-[#7a5c2e]">
                    {withRealName(
                      msg.guestName,
                      realNames[msg.guestId],
                      msg.fromAdmin || msg.guestId === ADMIN_GUEST_ID
                    )}
                  </span>
                  {msg.color && (
                    <span
                      title={`色塊：${BLESSING_COLORS.find((c) => c.hex === msg.color)?.name ?? msg.color}`}
                      className="w-3 h-3 rounded-full border border-black/10"
                      style={{ backgroundColor: msg.color }}
                    />
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATE_LABEL[st].className}`}>
                    {STATE_LABEL[st].text}
                  </span>
                  {msg.status === 'hidden' && (
                    <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">賓客已封鎖</span>
                  )}
                </div>

                {editingId === msg.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="w-full border border-[#c9a84c] rounded-xl px-3 py-2 text-sm focus:outline-none resize-none"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => saveEdit(msg.id)}
                        disabled={isBusy}
                        className="text-xs bg-[#c9a84c] text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        儲存
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-xs border text-gray-500 px-3 py-1.5 rounded-lg">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 break-words">{msg.message}</p>
                )}

                <p className="text-xs text-gray-400 mt-2">{new Date(msg.createdAt).toLocaleString('zh-TW')}</p>

                {/* 置頂 / 投放 / 編輯 / 刪除 */}
                <div className="grid grid-cols-4 gap-1.5 mt-3">
                  <button
                    onClick={() => send(msg.id, { action: st === 'pinned' ? 'unpin' : 'pin' })}
                    disabled={isBusy}
                    className={`text-xs py-2 rounded-lg transition-colors disabled:opacity-50 ${
                      st === 'pinned' ? 'bg-[#c9a84c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {st === 'pinned' ? '取消置頂' : '📌 置頂'}
                  </button>
                  <button
                    onClick={() => send(msg.id, { action: 'play' })}
                    // In rotation already — nothing to jump. From 已離開 or 待播 it
                    // goes to the front of the queue and flies next.
                    disabled={isBusy || st === 'playing' || st === 'pinned'}
                    title={
                      st === 'playing' || st === 'pinned'
                        ? '已在輪播中'
                        : '排到待播最前面，下一則就飛；飛過後進入輪播，之後仍會被新祝福擠出'
                    }
                    className="text-xs py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:hover:bg-gray-100"
                  >
                    ▶️ 投放
                  </button>
                  <button
                    onClick={() => { setEditingId(msg.id); setEditText(msg.message) }}
                    disabled={isBusy}
                    className="text-xs py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    ✏️ 編輯
                  </button>
                  <button
                    onClick={() => remove(msg.id)}
                    disabled={isBusy}
                    className="text-xs py-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    ❌ 刪除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
