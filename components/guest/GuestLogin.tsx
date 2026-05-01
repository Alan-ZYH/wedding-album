'use client'

import { useState } from 'react'

interface Props {
  onLogin: (name: string) => void
}

export default function GuestLogin({ onLogin }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('請輸入您的名稱')
      return
    }
    if (trimmed.length > 50) {
      setError('名稱不可超過 50 字')
      return
    }
    onLogin(trimmed)
  }

  return (
    <div className="min-h-screen bg-[#fdf8f0] flex flex-col items-center justify-center px-6">
      {/* Decorative top */}
      <div className="text-center mb-8">
        <div className="text-5xl mb-4">💍</div>
        <h1 className="text-3xl font-serif text-[#7a5c2e] mb-2">婚禮紀念相簿</h1>
        <div className="flex items-center gap-2 justify-center text-[#c9a84c]">
          <span className="h-px w-12 bg-[#c9a84c]"></span>
          <span className="text-sm">Wedding Album</span>
          <span className="h-px w-12 bg-[#c9a84c]"></span>
        </div>
        <p className="mt-4 text-sm text-gray-500 leading-relaxed">
          歡迎蒞臨！<br />
          請留下您的名稱，一起記錄這美好時刻
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-[#e8d5a3] p-6">
          <label className="block text-sm font-medium text-[#7a5c2e] mb-2">
            您的名稱
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="例：王小明"
            maxLength={50}
            className="w-full px-4 py-3 rounded-xl border border-[#e8d5a3] bg-[#fdf8f0] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/20 transition-all text-base"
            autoFocus
          />
          {error && (
            <p className="mt-2 text-xs text-red-500">{error}</p>
          )}

          <button
            type="submit"
            className="mt-4 w-full bg-[#c9a84c] hover:bg-[#b8953d] text-white font-medium py-3 rounded-xl transition-colors text-base"
          >
            進入相簿
          </button>
        </div>

        <p className="mt-4 text-xs text-center text-gray-400">
          名稱會顯示在您上傳的照片與祝福上
        </p>
      </form>
    </div>
  )
}
