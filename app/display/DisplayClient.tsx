'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Media, Message, Settings, DEFAULT_SETTINGS } from '@/types'
import DanmakuLayer from '@/components/display/DanmakuLayer'

export default function DisplayClient() {
  const [media, setMedia] = useState<Media[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success) setSettings(d.data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'media'),
      where('status', '==', 'active'),
      where('approved', '==', true),
      orderBy('uploadTime', 'asc')
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => d.data() as Media)
      const filtered = items.filter((m) => {
        if (m.fileType === 'video' && !settings.playVideos) return false
        return true
      })
      setMedia(settings.randomPlayback ? shuffle(filtered) : filtered)
      setLoading(false)
    })
    return () => unsub()
  }, [settings.playVideos, settings.randomPlayback])

  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'messages'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => d.data() as Message))
    })
    return () => unsub()
  }, [])

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % Math.max(media.length, 1))
  }, [media.length])

  const goPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + media.length) % Math.max(media.length, 1))
  }

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const current = media[currentIndex]
    if (!current) return
    if (current.fileType === 'video' && settings.playVideos) return
    timerRef.current = setTimeout(goNext, settings.slideInterval * 1000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [currentIndex, media, settings.slideInterval, settings.playVideos, goNext])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const current = media[currentIndex]

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen bg-black overflow-hidden cursor-pointer"
      onClick={goNext}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-white">
            <div className="text-6xl mb-4 animate-pulse">💍</div>
            <p className="text-xl font-serif opacity-70">婚禮紀念相簿</p>
            <p className="text-sm opacity-40 mt-2">等待賓客上傳照片...</p>
          </div>
        </div>
      ) : media.length === 0 ? (
        <WaitingScreen />
      ) : current ? (
        <Slide item={current} settings={settings} onVideoEnd={goNext} transition={settings.slideTransition ?? 'fade'} />
      ) : null}

      {settings.showDanmaku && messages.length > 0 && (
        <DanmakuLayer
          messages={messages}
          speed={settings.danmakuSpeed}
          density={settings.danmakuDensity}
          fontSize={settings.danmakuFontSize}
          danmakuStyle={settings.danmakuStyle ?? 'scroll'}
        />
      )}

      <div
        className="absolute top-0 left-0 right-0 flex justify-between items-center px-6 py-4 opacity-0 hover:opacity-100 transition-opacity bg-gradient-to-b from-black/50 to-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={goPrev}
          className="text-white/70 hover:text-white bg-black/40 rounded-full px-4 py-2 text-sm transition-colors"
        >
          ← 上一張
        </button>
        <div className="text-white/60 text-sm font-mono">
          {media.length > 0 ? `${currentIndex + 1} / ${media.length}` : ''}
        </div>
        <button
          onClick={toggleFullscreen}
          className="text-white/70 hover:text-white bg-black/40 rounded-full px-4 py-2 text-sm transition-colors"
        >
          {isFullscreen ? '⊠ 退出全螢幕' : '⊞ 全螢幕'}
        </button>
      </div>

      {media.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 flex gap-0.5 px-4 pb-3 opacity-30 hover:opacity-70 transition-opacity">
          {media.map((_, i) => (
            <div
              key={i}
              onClick={(e) => { e.stopPropagation(); setCurrentIndex(i) }}
              className={`h-0.5 flex-1 rounded-full transition-colors cursor-pointer ${
                i === currentIndex ? 'bg-[#c9a84c]' : 'bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Slide({ item, settings, onVideoEnd, transition }: { item: Media; settings: Settings; onVideoEnd: () => void; transition: string }) {
  // Auto-advance videos after 2 minutes (iframe has no onEnded callback)
  useEffect(() => {
    if (item.fileType !== 'video' || !settings.playVideos) return
    const timer = setTimeout(onVideoEnd, 120_000)
    return () => clearTimeout(timer)
  }, [item.id, item.fileType, settings.playVideos, onVideoEnd])

  if (item.fileType === 'video' && settings.playVideos) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black relative">
        {/* Google Drive iframe player – most reliable way to play Drive-hosted videos */}
        <iframe
          key={item.id}
          src={`https://drive.google.com/file/d/${item.googleDriveFileId}/preview`}
          allow="autoplay; fullscreen"
          allowFullScreen
          className="w-full h-full"
          style={{ border: 'none' }}
        />
        {settings.showGuestName && <GuestNameBadge name={item.guestName} />}
      </div>
    )
  }
  return (
    <div className="w-full h-full flex items-center justify-center relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={item.id}
        src={`https://lh3.googleusercontent.com/d/${item.googleDriveFileId}=w1920`}
        alt={item.fileName}
        className={`max-w-full max-h-full object-contain transition-${transition}`}
        onError={(e) => {
          const img = e.target as HTMLImageElement
          if (!img.src.includes('thumbnail')) {
            img.src = `https://drive.google.com/thumbnail?id=${item.googleDriveFileId}&sz=w1920`
          }
        }}
      />
      {settings.showGuestName && <GuestNameBadge name={item.guestName} />}
    </div>
  )
}

function GuestNameBadge({ name }: { name: string }) {
  return (
    <div className="absolute bottom-8 right-6 bg-black/50 backdrop-blur-sm text-white/80 text-sm px-3 py-1.5 rounded-full">
      Photo by {name}
    </div>
  )
}

function WaitingScreen() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center text-white">
        <div className="text-8xl mb-6">💍</div>
        <h1 className="text-4xl font-serif text-[#c9a84c] mb-3">婚禮紀念相簿</h1>
        <div className="flex items-center gap-3 justify-center text-[#c9a84c]/60 mb-6">
          <span className="h-px w-16 bg-[#c9a84c]/40"></span>
          <span className="text-sm">Wedding Album</span>
          <span className="h-px w-16 bg-[#c9a84c]/40"></span>
        </div>
        <p className="text-gray-400 text-sm">掃描 QR Code 上傳您的照片</p>
        <p className="text-gray-500 text-xs mt-2 animate-pulse">等待照片上傳中...</p>
      </div>
    </div>
  )
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
