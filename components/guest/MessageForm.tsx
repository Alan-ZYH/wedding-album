'use client'

import { useState, useEffect } from 'react'
import { Message } from '@/types'

interface Props {
  guestId: string
  guestName: string
}

export default function MessageForm({ guestId, guestName }: Props) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [myMessages, setMyMessages] = useState<Message[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const fetchMyMessages = async () => {
    try {
      const res = await fetch(`/api/messages?guestId=${guestId}`)
      const data = await res.json()
      if (data.success) {
        setMyMessages(data.data.filter((m: Message) => m.status === 'active'))
      }
    } catch {}
  }

  useEffect(() => {
    fetchMyMessages()
  }, [guestId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) { setError('請輸入祝福內容'); return }
    if (trimmed.length > 500) { setError('祝福不可超過 500 字'); return }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, guestName, message: trimmed }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage('')
        setSubmitted(true)
        await fetchMyMessages()
        setTimeout(() => setSubmitted(false), 3000)
      } else {
        setError(data.error || '送出失敗')
      }
    } catch {
      setError('網路錯誤，請重試')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async (id: string) => {
    const trimmed = editText.trim()
    if (!trimmed) return
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, message: trimmed }),
      })
      if ((await res.json()).success) {
        setEditingId(null)
        await fetchMyMessages()
      }
    } catch {}
  }

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這則祝福嗎？')) return
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, status: 'deleted' }),
      })
      if ((await res.json()).success) {
        await fetchMyMessages()
      }
    } catch {}
  }

  return (
    <div>
      <h2 className="text-lg font-serif text-[#7a5c2e] mb-1">送上祝福</h2>
      <p className="text-xs text-gray-400 mb-4">您的祝福將會在大螢幕上滾動飄過</p>

      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-2xl border border-[#e8d5a3] p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-[#c9a84c]/20 flex items-center justify-center text-sm font-medium text-[#c9a84c]">
              {guestName.charAt(0)}
            </div>
            <span className="text-sm font-medium text-gray-700">{guestName}</span>
          </div>
          <textarea
            value={message}
            onChange={(e) => { setMessage(e.target.value); setError('') }}
            placeholder="寫下您對新人的祝福..."
            maxLength={500}
            rows={4}
            className="w-full resize-none bg-[#fdf8f0] border border-[#e8d5a3] rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#c9a84c] transition-colors"
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-gray-400">{message.length}/500</span>
          </div>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          {submitted && (
            <p className="text-xs text-green-600 mt-1">✓ 祝福已送出，感謝您！</p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className={`mt-3 w-full py-3 rounded-xl font-medium text-sm transition-all ${
            submitting || !message.trim()
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
          }`}
        >
          {submitting ? '送出中...' : '送出祝福 ♡'}
        </button>
      </form>

      {/* My messages */}
      {myMessages.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-600 mb-3">我的祝福 ({myMessages.length})</h3>
          <div className="space-y-3">
            {myMessages.map((msg) => (
              <div key={msg.id} className="bg-white rounded-xl border border-[#e8d5a3] p-3">
                {editingId === msg.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="w-full resize-none text-sm border border-[#e8d5a3] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#c9a84c]"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleEdit(msg.id)}
                        className="text-xs bg-[#c9a84c] text-white px-3 py-1 rounded-lg"
                      >
                        儲存
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 px-3 py-1 rounded-lg border"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-700">{msg.message}</p>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-xs text-gray-400">
                        {new Date(msg.createdAt).toLocaleDateString('zh-TW')}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingId(msg.id); setEditText(msg.message) }}
                          className="text-xs text-[#c9a84c] hover:underline"
                        >
                          編輯
                        </button>
                        <button
                          onClick={() => handleDelete(msg.id)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          刪除
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
