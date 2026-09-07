'use client'

import { useState, useEffect } from 'react'

interface Props {
  guestId: string
  guestName: string
  /** Seconds between blessings. 0 disables the cooldown (used by the couple). */
  cooldownSeconds?: number
  /** Set by the admin panel so the blessing is styled as the couple's. */
  fromAdmin?: boolean
}

export default function MessageForm({ guestId, guestName, cooldownSeconds = 30, fromAdmin = false }: Props) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  // Blessings have their own 30s cooldown, independent of photo uploads
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

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
        body: JSON.stringify({ guestId, guestName, message: trimmed, fromAdmin }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage('')
        setSubmitted(true)
        if (cooldownSeconds > 0) setCooldown(cooldownSeconds)
        setTimeout(() => setSubmitted(false), 3000)
      } else {
        // Server is the source of truth for cooldown / block state
        if (typeof data.remaining === 'number') setCooldown(data.remaining)
        setError(data.error || '送出失敗')
      }
    } catch {
      setError('網路錯誤，請重試')
    } finally {
      setSubmitting(false)
    }
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
          disabled={submitting || !message.trim() || cooldown > 0}
          className={`mt-3 w-full py-3 rounded-xl font-medium text-sm transition-all ${
            submitting || !message.trim() || cooldown > 0
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
          }`}
        >
          {submitting ? '送出中...'
            : cooldown > 0 ? `請稍候 ${cooldown} 秒`
            : '送出祝福 ♡'}
        </button>
      </form>

      <p className="text-xs text-gray-400 mt-4 text-center">
        送出後可在「我的上傳」修改或刪除自己的祝福
      </p>
    </div>
  )
}
