'use client'

import { useState, useEffect } from 'react'
import { Settings, DEFAULT_SETTINGS } from '@/types'
import UploadForm from '@/components/guest/UploadForm'
import MessageForm from '@/components/guest/MessageForm'
import { ADMIN_GUEST_ID } from '@/lib/guest-names'
import BlessingColorPicker from '@/components/admin/BlessingColorPicker'
import { DEFAULT_BLESSING_COLOR, isBlessingColor } from '@/lib/blessing-colors'

const LAST_COLOR_KEY = 'wedding_admin_blessing_color'


export default function AdminUploadPage() {
  const [tab, setTab] = useState<'upload' | 'message'>('upload')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success) setSettings({ ...DEFAULT_SETTINGS, ...d.data }) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const adminName = settings.adminName || DEFAULT_SETTINGS.adminName

  // The colour for the NEXT blessing only. Remembered in this browser as a
  // convenience, never saved anywhere shared: blessings already sent keep the
  // colour they were sent with.
  const [color, setColor] = useState<string | null>(DEFAULT_BLESSING_COLOR)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_COLOR_KEY)
      if (saved === 'none') setColor(null)
      else if (isBlessingColor(saved)) setColor(saved)
    } catch { /* private mode — the default is fine */ }
  }, [])
  const chooseColor = (c: string | null) => {
    setColor(c)
    try { localStorage.setItem(LAST_COLOR_KEY, c ?? 'none') } catch {}
  }

  const saveName = async (value = nameDraft) => {
    const next = value.trim().slice(0, 20)
    if (!next || next === adminName) { setEditingName(false); return }
    setSavingName(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminName: next }),
      })
      if ((await res.json()).success) {
        setSettings((s) => ({ ...s, adminName: next }))
        setEditingName(false)
      }
    } catch {}
    finally { setSavingName(false) }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div className="max-w-lg">
      <div className="mb-5">
        <h1 className="text-2xl font-serif text-gray-800">新人上傳</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          與賓客端相同的規範，但不受單次張數與冷卻限制
        </p>
      </div>

      {/* Display name */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0"
            style={{
              backgroundColor: `${color ?? DEFAULT_BLESSING_COLOR}22`,
              color: color ?? DEFAULT_BLESSING_COLOR,
            }}
          >
            {adminName.charAt(0)}
          </div>
          {editingName ? (
            <>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName() }}
                maxLength={20}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[#c9a84c]"
              />
              <button
                onClick={() => saveName()}
                disabled={savingName}
                className="text-xs bg-[#c9a84c] hover:bg-[#b8953d] text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {savingName ? '儲存中' : '儲存'}
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="text-xs text-gray-500 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{adminName}</p>
                <p className="text-xs text-gray-400">顯示在照片與祝福上</p>
              </div>
              <button
                onClick={() => { setNameDraft(adminName); setEditingName(true) }}
                className="text-xs text-[#c9a84c] hover:underline shrink-0"
              >
                修改名稱
              </button>
            </>
          )}
        </div>

        {/* The two people who post from here — one tap, no typing mid-reception */}
        <div className="flex gap-2 mt-3">
          {['新郎', '新娘'].map((n) => (
            <button
              key={n}
              onClick={() => saveName(n)}
              disabled={savingName}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                adminName === n
                  ? 'bg-[#c9a84c] text-white'
                  : 'bg-[#fdf8f0] border border-[#e8d5a3] text-[#7a5c2e] hover:bg-[#f8f0dd]'
              }`}
            >
              {n === '新郎' ? '🤵 新郎' : '👰 新娘'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5">
        {([
          { key: 'upload', label: '上傳照片' },
          { key: 'message', label: '送上祝福' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-[#c9a84c] text-[#7a5c2e]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <UploadForm
          guestId={ADMIN_GUEST_ID}
          guestName={adminName}
          maxFiles={20}
          cooldownSeconds={0}
        />
      ) : (
        <>
          <MessageForm
            guestId={ADMIN_GUEST_ID}
            guestName={adminName}
            cooldownSeconds={0}
            fromAdmin
            allowPin
            color={color}
          />
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">這則祝福在大螢幕上的樣子</p>
            <BlessingColorPicker name={adminName} color={color} onChange={chooseColor} />
            <p className="text-xs text-gray-400 mt-3">
              顏色跟著這一則走，送出後就固定，不會因為之後選別的顏色而改變。要換顏色請到「祝福管理」刪除後重發。
            </p>
          </div>
        </>
      )}
    </div>
  )
}
