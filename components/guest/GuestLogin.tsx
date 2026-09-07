'use client'

import { useState } from 'react'

interface Props {
  onLogin: (realName: string, guestName: string) => void
  /** Existing guest whose real name predates this screen — keep their id. */
  initial?: { realName?: string; guestName?: string }
}

export default function GuestLogin({ onLogin, initial }: Props) {
  const [realName, setRealName] = useState(initial?.realName ?? '')
  const [guestName, setGuestName] = useState(initial?.guestName ?? '')
  const [error, setError] = useState('')
  const backfill = Boolean(initial)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const real = realName.trim()
    // Most guests are happy to be shown by their own name; asking twice and
    // demanding an answer both times just adds a step before the album.
    const display = guestName.trim() || real
    if (!real) {
      setError('請輸入您的本名')
      return
    }
    if (real.length > 20 || display.length > 20) {
      setError('名稱不可超過 20 字')
      return
    }
    onLogin(real, display)
  }

  return (
    <div className="min-h-screen bg-[#fdf8f0] flex flex-col items-center justify-center px-6 py-10">
      <div className="text-center mb-8">
        <div className="text-5xl mb-4">💍</div>
        <h1 className="text-3xl font-serif text-[#7a5c2e] mb-2">婚禮紀念相簿</h1>
        <div className="flex items-center gap-2 justify-center text-[#c9a84c]">
          <span className="h-px w-12 bg-[#c9a84c]"></span>
          <span className="text-sm">Wedding Album</span>
          <span className="h-px w-12 bg-[#c9a84c]"></span>
        </div>
        <p className="mt-4 text-sm text-gray-500 leading-relaxed">
          {backfill ? (
            <>為了讓新人認得出您<br />請補上您的本名</>
          ) : (
            <>歡迎蒞臨！<br />請留下您的名稱，一起記錄這美好時刻</>
          )}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-[#e8d5a3] p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#7a5c2e] mb-1">
              您的本名
            </label>
            <p className="text-xs text-gray-400 mb-2">只有新人看得到，不會出現在大螢幕</p>
            <input
              type="text"
              value={realName}
              onChange={(e) => { setRealName(e.target.value); setError('') }}
              placeholder="例：王小明"
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl border border-[#e8d5a3] bg-[#fdf8f0] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/20 transition-all text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#7a5c2e] mb-1">
              投影顯示名稱
            </label>
            <p className="text-xs text-gray-400 mb-2">會顯示在大螢幕上，留空就用本名</p>
            <input
              type="text"
              value={guestName}
              onChange={(e) => { setGuestName(e.target.value); setError('') }}
              placeholder="例：小明"
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl border border-[#e8d5a3] bg-[#fdf8f0] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/20 transition-all text-base"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            className="w-full bg-[#c9a84c] hover:bg-[#b8953d] text-white font-medium py-3 rounded-xl transition-colors text-base"
          >
            {backfill ? '儲存並繼續' : '進入相簿'}
          </button>
        </div>

        <p className="mt-4 text-xs text-center text-gray-400">
          兩個名稱之後都能隨時修改
        </p>
      </form>
    </div>
  )
}
