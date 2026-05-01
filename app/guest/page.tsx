'use client'

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import GuestLogin from '@/components/guest/GuestLogin'
import UploadForm from '@/components/guest/UploadForm'
import MyUploads from '@/components/guest/MyUploads'
import MessageForm from '@/components/guest/MessageForm'

const GUEST_KEY = 'wedding_guest'

interface GuestInfo {
  guestId: string
  guestName: string
}

export default function GuestPage() {
  const [guest, setGuest] = useState<GuestInfo | null>(null)
  const [activeTab, setActiveTab] = useState<'upload' | 'message' | 'myUploads'>('upload')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem(GUEST_KEY)
    if (stored) {
      try {
        setGuest(JSON.parse(stored))
      } catch {
        localStorage.removeItem(GUEST_KEY)
      }
    }
  }, [])

  const handleLogin = (name: string) => {
    const guestId = uuidv4()
    const info: GuestInfo = { guestId, guestName: name }
    localStorage.setItem(GUEST_KEY, JSON.stringify(info))
    setGuest(info)
  }

  const handleLogout = () => {
    localStorage.removeItem(GUEST_KEY)
    setGuest(null)
  }

  if (!mounted) return null

  if (!guest) {
    return <GuestLogin onLogin={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-[#fdf8f0]">
      {/* Header */}
      <header className="bg-white border-b border-[#e8d5a3] sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-serif text-[#7a5c2e] leading-tight">婚禮紀念相簿</h1>
            <p className="text-xs text-[#c9a84c]">歡迎，{guest.guestName}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            更換名稱
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-lg mx-auto px-4 flex border-t border-[#f0e0c0]">
          {[
            { key: 'upload', label: '上傳照片' },
            { key: 'message', label: '送上祝福' },
            { key: 'myUploads', label: '我的上傳' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-[#c9a84c] text-[#7a5c2e]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-lg mx-auto px-4 py-6">
        {activeTab === 'upload' && (
          <UploadForm guestId={guest.guestId} guestName={guest.guestName} />
        )}
        {activeTab === 'message' && (
          <MessageForm guestId={guest.guestId} guestName={guest.guestName} />
        )}
        {activeTab === 'myUploads' && (
          <MyUploads guestId={guest.guestId} />
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-lg mx-auto px-4 py-8 text-center">
        <div className="text-[#c9a84c] text-lg mb-1">♡</div>
        <p className="text-xs text-gray-400">感謝您的蒞臨與祝福</p>
      </footer>
    </div>
  )
}
