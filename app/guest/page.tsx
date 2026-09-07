'use client'

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { DEFAULT_SETTINGS } from '@/types'
import GuestLogin from '@/components/guest/GuestLogin'
import UploadForm from '@/components/guest/UploadForm'
import MyUploads from '@/components/guest/MyUploads'
import MessageForm from '@/components/guest/MessageForm'
import NameEditor from '@/components/guest/NameEditor'

const GUEST_KEY = 'wedding_guest'

interface GuestInfo {
  guestId: string
  /** 投影顯示名稱 — the name that goes on photos, blessings and the screen */
  guestName: string
  /** 本名 — sent to the server for the couple, never shown to other guests */
  realName?: string
}

export default function GuestPage() {
  const [guest, setGuest] = useState<GuestInfo | null>(null)
  const [activeTab, setActiveTab] = useState<'upload' | 'message' | 'myUploads'>('upload')
  const [mounted, setMounted] = useState(false)
  const [albumName, setAlbumName] = useState(DEFAULT_SETTINGS.albumName)
  const [editingName, setEditingName] = useState(false)

  useEffect(() => {
    setMounted(true)
    // A guest arriving by QR code must land on the header — the album name and
    // the three tabs are the only signposts they get. iOS otherwise restores
    // wherever the page was left, which drops them into the middle of the form
    // with nothing on screen suggesting there is anything above it.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
    const stored = localStorage.getItem(GUEST_KEY)
    if (stored) {
      try {
        setGuest(JSON.parse(stored))
      } catch {
        localStorage.removeItem(GUEST_KEY)
      }
    }
  }, [])

  // Real-time settings sync — album name updates instantly when admin changes it
  useEffect(() => {
    if (!db) return
    const unsub = onSnapshot(
      doc(db, 'settings', 'config'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data()
          if (data?.albumName) setAlbumName(data.albumName)
        }
      },
      () => {} // ignore errors, keep default
    )
    return () => unsub()
  }, [])

  /** Record the names against the guest id so the couple can trace edits. */
  const register = (info: GuestInfo) => {
    fetch('/api/guests/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: info.guestId,
        realName: info.realName,
        guestName: info.guestName,
      }),
    }).catch(() => {
      // The name is already in localStorage and rides along with every upload,
      // so a failure here costs the couple a history entry, not the guest's
      // place in the album.
    })
  }

  const saveGuest = (info: GuestInfo) => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(info))
    setGuest(info)
    register(info)
  }

  /**
   * Both entering the album and filling in a missing real name land here. The
   * id is reused when one already exists: issuing a fresh one would let a
   * blocked guest shed their identity in two taps.
   */
  const handleLogin = (realName: string, guestName: string) => {
    saveGuest({ guestId: guest?.guestId ?? uuidv4(), guestName, realName })
    window.scrollTo(0, 0)
  }

  const handleRename = (realName: string, guestName: string) => {
    if (!guest) return
    setEditingName(false)
    if (realName === guest.realName && guestName === guest.guestName) return
    saveGuest({ guestId: guest.guestId, guestName, realName })
  }

  if (!mounted) return null

  if (!guest) {
    return <GuestLogin onLogin={handleLogin} />
  }

  // Guests who joined before the album asked for a real name
  if (!guest.realName) {
    return <GuestLogin onLogin={handleLogin} initial={{ guestName: guest.guestName }} />
  }

  return (
    <div className="min-h-screen bg-[#fdf8f0]">
      {/* Header */}
      <header className="bg-white border-b border-[#e8d5a3] sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-serif text-[#7a5c2e] leading-tight">{albumName}</h1>
            <p className="text-xs text-[#c9a84c]">歡迎，{guest.guestName}</p>
          </div>
          <button
            onClick={() => setEditingName(true)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            修改名稱
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
              onClick={() => {
                setActiveTab(tab.key as typeof activeTab)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
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
          <UploadForm
            guestId={guest.guestId}
            guestName={guest.guestName}
            onViewUploads={() => setActiveTab('myUploads')}
          />
        )}
        {activeTab === 'message' && (
          <MessageForm guestId={guest.guestId} guestName={guest.guestName} />
        )}
        {activeTab === 'myUploads' && (
          <MyUploads guestId={guest.guestId} />
        )}
      </main>

      {editingName && (
        <NameEditor
          realName={guest.realName ?? ''}
          guestName={guest.guestName}
          onSave={handleRename}
          onClose={() => setEditingName(false)}
        />
      )}

      {/* Footer */}
      <footer className="max-w-lg mx-auto px-4 py-8 text-center">
        <div className="text-[#c9a84c] text-lg mb-1">♡</div>
        <p className="text-xs text-gray-400">感謝您的蒞臨與祝福</p>
      </footer>
    </div>
  )
}
