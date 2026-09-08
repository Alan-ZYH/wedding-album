'use client'

import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Message } from '@/types'
import { useRealNames, withRealName } from '@/lib/guest-names'

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newMsg, setNewMsg] = useState({ guestName: '', message: '' })
  const [addingNew, setAddingNew] = useState(false)
  const [filter, setFilter] = useState('')

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

  const filtered = messages.filter((m) => {
    if (m.status === 'deleted') return false
    if (!filter) return true
    const s = filter.toLowerCase()
    return (
      m.guestName.toLowerCase().includes(s) ||
      (realNames[m.guestId] ?? '').toLowerCase().includes(s) ||
      m.message.toLowerCase().includes(s)
    )
  })

  const updateMsg = async (id: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if ((await res.json()).success) {
        setMessages((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } as Message : m))
        setEditingId(null)
      }
    } catch {}
  }

  const deleteMsg = async (id: string) => {
    if (!confirm('確定刪除這則祝福？')) return
    try {
      const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' })
      if ((await res.json()).success) {
        setMessages((prev) => prev.filter((m) => m.id !== id))
      }
    } catch {}
  }

  const addMessage = async () => {
    if (!newMsg.message.trim()) return
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: 'admin',
          guestName: newMsg.guestName || '管理員',
          message: newMsg.message,
        }),
      })
      if ((await res.json()).success) {
        setNewMsg({ guestName: '', message: '' })
        setAddingNew(false)
        // the snapshot listener brings the new blessing in on its own
      }
    } catch {}
  }

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">祝福管理</h1>
          <p className="text-sm text-gray-400">共 {filtered.length} 則祝福</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              placeholder="名稱（選填）"
              value={newMsg.guestName}
              onChange={(e) => setNewMsg((p) => ({ ...p, guestName: e.target.value }))}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c]"
            />
          </div>
          <textarea
            placeholder="祝福內容..."
            value={newMsg.message}
            onChange={(e) => setNewMsg((p) => ({ ...p, message: e.target.value }))}
            rows={3}
            maxLength={500}
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c] resize-none"
          />
          <div className="flex gap-2 mt-3">
            <button onClick={addMessage} className="text-sm bg-[#c9a84c] text-white px-4 py-2 rounded-xl hover:bg-[#b8953d]">
              新增
            </button>
            <button onClick={() => setAddingNew(false)} className="text-sm text-gray-500 px-4 py-2 rounded-xl border hover:bg-gray-50">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="搜尋名稱或內容..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a84c] bg-white"
        />
      </div>

      {/* Messages list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">💌</div>
          <p>還沒有祝福</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((msg) => (
            <div
              key={msg.id}
              className={`bg-white rounded-2xl border p-4 ${
                msg.status === 'hidden' ? 'border-gray-200 opacity-60' : 'border-gray-200'
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[#7a5c2e]">
                      {withRealName(msg.guestName, realNames[msg.guestId])}
                    </span>
                    {msg.priority === 2 && (
                      <span className="text-xs bg-[#c9a84c]/20 text-[#7a5c2e] px-2 py-0.5 rounded-full">
                        高優先
                      </span>
                    )}
                    {msg.status === 'hidden' && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                        已隱藏
                      </span>
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
                          onClick={() => updateMsg(msg.id, { message: editText })}
                          className="text-xs bg-[#c9a84c] text-white px-3 py-1.5 rounded-lg"
                        >
                          儲存
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs border text-gray-500 px-3 py-1.5 rounded-lg"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700">{msg.message}</p>
                  )}

                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(msg.createdAt).toLocaleString('zh-TW')}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => { setEditingId(msg.id); setEditText(msg.message) }}
                    className="text-xs text-[#c9a84c] hover:underline whitespace-nowrap"
                  >
                    編輯
                  </button>
                  <button
                    onClick={() => updateMsg(msg.id, { status: msg.status === 'hidden' ? 'active' : 'hidden' })}
                    className="text-xs text-gray-500 hover:underline whitespace-nowrap"
                  >
                    {msg.status === 'hidden' ? '顯示' : '隱藏'}
                  </button>
                  <button
                    onClick={() => updateMsg(msg.id, { priority: msg.priority === 2 ? 1 : 2 })}
                    className="text-xs text-orange-500 hover:underline whitespace-nowrap"
                  >
                    {msg.priority === 2 ? '正常' : '提升'}
                  </button>
                  <button
                    onClick={() => deleteMsg(msg.id)}
                    className="text-xs text-red-400 hover:underline whitespace-nowrap"
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
