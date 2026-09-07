'use client'

import { useState } from 'react'

interface Props {
  realName: string
  guestName: string
  onSave: (realName: string, guestName: string) => void
  onClose: () => void
}

/**
 * Lets a guest change either of their names after entering the album.
 * Both edits are recorded server-side, so the couple can still trace a screen
 * name back to whoever chose it.
 */
export default function NameEditor({ realName, guestName, onSave, onClose }: Props) {
  const [real, setReal] = useState(realName)
  const [display, setDisplay] = useState(guestName)
  const [error, setError] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = real.trim()
    const d = display.trim() || r
    if (!r) { setError('請輸入您的本名'); return }
    if (r.length > 20 || d.length > 20) { setError('名稱不可超過 20 字'); return }
    onSave(r, d)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4"
      >
        <h2 className="text-base font-medium text-[#7a5c2e]">修改名稱</h2>

        <div>
          <label className="block text-sm text-[#7a5c2e] mb-1">您的本名</label>
          <p className="text-xs text-gray-400 mb-1.5">只有新人看得到</p>
          <input
            type="text"
            value={real}
            onChange={(e) => { setReal(e.target.value); setError('') }}
            maxLength={20}
            className="w-full px-3 py-2.5 rounded-xl border border-[#e8d5a3] bg-[#fdf8f0] focus:outline-none focus:border-[#c9a84c] text-base"
          />
        </div>

        <div>
          <label className="block text-sm text-[#7a5c2e] mb-1">投影顯示名稱</label>
          <p className="text-xs text-gray-400 mb-1.5">會顯示在大螢幕上</p>
          <input
            type="text"
            value={display}
            onChange={(e) => { setDisplay(e.target.value); setError('') }}
            maxLength={20}
            className="w-full px-3 py-2.5 rounded-xl border border-[#e8d5a3] bg-[#fdf8f0] focus:outline-none focus:border-[#c9a84c] text-base"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <p className="text-xs text-gray-400">
          已經上傳的照片與祝福會沿用當時的顯示名稱。
        </p>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm"
          >
            取消
          </button>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-xl bg-[#c9a84c] hover:bg-[#b8953d] text-white text-sm font-medium transition-colors"
          >
            儲存
          </button>
        </div>
      </form>
    </div>
  )
}
