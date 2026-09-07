'use client'

import { useState, useEffect } from 'react'
import { Settings, DEFAULT_SETTINGS } from '@/types'
import UploadForm from '@/components/guest/UploadForm'
import MessageForm from '@/components/guest/MessageForm'

/** Fixed id so everything the couple posts groups together and stays out of
 *  the guest list (recordGuestAction is skipped for admins). */
const ADMIN_GUEST_ID = 'admin'

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

  const saveName = async () => {
    const next = nameDraft.trim().slice(0, 20)
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
              backgroundColor: `${settings.adminMessageColor ?? '#c9a84c'}22`,
              color: settings.adminMessageColor ?? '#c9a84c',
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
                onClick={saveName}
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
          />
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-2">大螢幕上的呈現方式</p>
            <div className="bg-gray-900 rounded-lg py-4 px-3 flex justify-center">
              <span
                className="px-4 py-1.5 rounded-full text-sm font-medium"
                style={{
                  backgroundColor: `${settings.adminMessageColor ?? '#c9a84c'}26`,
                  color: settings.adminMessageColor ?? '#c9a84c',
                  border: `1px solid ${settings.adminMessageColor ?? '#c9a84c'}66`,
                }}
              >
                {adminName}：新婚快樂
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              顏色可在「設定 → 新人祝福樣式」調整
            </p>
          </div>
        </>
      )}
    </div>
  )
}
