'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { collection, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore'
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

  // ── Feature 5: Real-time settings via Firestore onSnapshot ──
  useEffect(() => {
    if (!db) return
    const unsub = onSnapshot(
      doc(db, 'settings', 'config'),
      (snap) => {
        if (snap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...snap.data() } as Settings)
        }
      },
      () => {} // keep defaults on error
    )
    return () => unsub()
  }, [])

  // ── Feature 6: Real-time media (already using onSnapshot) ──
  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'media'),
      where('status', '==', 'active'),
      where('approved', '==', true),
      orderBy('uploadTime', 'asc')
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => d.data() as Media)
        // Feature 7: skip items that failed to display
        .filter((m) => !m.displayError)
        .filter((m) => {
          if (m.fileType === 'video' && !settings.playVideos) return false
          return true
        })
      setMedia(settings.randomPlayback ? shuffle(items) : items)
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

  // Auto-advance timer for photos
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const current = media[currentIndex]
    if (!current) return
    // Videos manage their own advancement via onEnded
    if (current.fileType === 'video' && settings.playVideos) return
    timerRef.current = setTimeout(goNext, settings.slideInterval * 1000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [currentIndex, media, settings.slideInterval, settings.playVideos, goNext])

  // Feature 7: mark a media item as having a display error
  const markDisplayError = useCallback(async (mediaId: string) => {
    try {
      await fetch(`/api/media/${mediaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayError: true }),
      })
    } catch {}
  }, [])

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
  // Pre-render the NEXT item so it's buffered before we switch to it
  const nextIndex = media.length > 1 ? (currentIndex + 1) % media.length : -1
  const nextItem = nextIndex >= 0 ? media[nextIndex] : null

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
            <p className="text-xl font-serif opacity-70">{settings.albumName || DEFAULT_SETTINGS.albumName}</p>
            <p className="text-sm opacity-40 mt-2">等待賓客上傳照片...</p>
          </div>
        </div>
      ) : media.length === 0 ? (
        <WaitingScreen albumName={settings.albumName || DEFAULT_SETTINGS.albumName} />
      ) : (
        <>
          {/* Current slide */}
          {current && (
            <Slide
              key={current.id}
              item={current}
              settings={settings}
              active={true}
              onVideoEnd={goNext}
              onMediaError={() => { markDisplayError(current.id); goNext() }}
              transition={settings.slideTransition ?? 'fade'}
            />
          )}
          {/* Next slide — hidden, pre-buffering to eliminate black-screen gap */}
          {nextItem && (
            <Slide
              key={nextItem.id}
              item={nextItem}
              settings={settings}
              active={false}
              onVideoEnd={goNext}
              onMediaError={() => { markDisplayError(nextItem.id) }}
              transition={settings.slideTransition ?? 'fade'}
            />
          )}
        </>
      )}

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
        className="absolute top-0 left-0 right-0 flex justify-between items-center px-6 py-4 opacity-0 hover:opacity-100 transition-opacity bg-gradient-to-b from-black/50 to-transparent z-30"
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
        <div className="absolute bottom-0 left-0 right-0 flex gap-0.5 px-4 pb-3 opacity-30 hover:opacity-70 transition-opacity z-30">
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

// ── Slide component with double-buffer support ──
function Slide({
  item,
  settings,
  active,
  onVideoEnd,
  onMediaError,
  transition,
}: {
  item: Media
  settings: Settings
  active: boolean
  onVideoEnd: () => void
  onMediaError: () => void
  transition: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const errorReported = useRef(false)

  // Reset error flag when item changes
  useEffect(() => {
    errorReported.current = false
  }, [item.id])

  // Feature 8: Control video playback based on active state
  // When active=false the video preloads silently; when active=true it starts playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active) {
      v.currentTime = 0
      v.play().catch(() => {
        // Autoplay blocked — retry muted
        v.muted = true
        v.play().catch(() => {})
      })
    } else {
      v.pause()
      v.currentTime = 0
    }
  }, [active])

  // Safety fallback: if postMessage never fires, advance after 5 minutes
  useEffect(() => {
    if (!active || item.fileType !== 'video' || !settings.playVideos) return
    const timer = setTimeout(onVideoEnd, 300_000)
    return () => clearTimeout(timer)
  }, [active, item.id, item.fileType, settings.playVideos, onVideoEnd])

  const containerClass = `absolute inset-0 transition-opacity duration-500 ${
    active ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
  }`

  const handleVideoError = () => {
    if (errorReported.current) return
    errorReported.current = true
    onMediaError()
    if (active) onVideoEnd() // advance slide
  }

  const handlePhotoError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement
    if (!img.src.includes('thumbnail')) {
      // First fallback
      img.src = `https://drive.google.com/thumbnail?id=${item.googleDriveFileId}&sz=w1920`
    } else if (!errorReported.current) {
      // Both URLs failed — report error
      errorReported.current = true
      onMediaError()
    }
  }

  if (item.fileType === 'video' && settings.playVideos) {
    return (
      <div className={`${containerClass} flex items-center justify-center bg-black`}>
        {/* Feature 8: direct <video> instead of iframe — eliminates iframe load overhead.
            preload="auto" buffers data while active=false so playback starts instantly. */}
        <video
          ref={videoRef}
          src={`/api/video/${item.googleDriveFileId}`}
          muted={settings.muteVideos !== false}
          playsInline
          preload="auto"
          onEnded={onVideoEnd}
          onError={handleVideoError}
          className="w-full h-full object-contain"
        />
        {settings.showGuestName && active && <GuestNameBadge name={item.guestName} />}
      </div>
    )
  }

  return (
    <div className={`${containerClass} flex items-center justify-center bg-black`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://lh3.googleusercontent.com/d/${item.googleDriveFileId}=w1920`}
        alt={item.fileName}
        className={`max-w-full max-h-full object-contain transition-${transition}`}
        onError={handlePhotoError}
      />
      {settings.showGuestName && active && <GuestNameBadge name={item.guestName} />}
    </div>
  )
}

function GuestNameBadge({ name }: { name: string }) {
  return (
    <div className="absolute bottom-8 right-6 bg-black/50 backdrop-blur-sm text-white/80 text-sm px-3 py-1.5 rounded-full z-20">
      Photo by {name}
    </div>
  )
}

function WaitingScreen({ albumName }: { albumName: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center text-white">
        <div className="text-8xl mb-6">💍</div>
        <h1 className="text-4xl font-serif text-[#c9a84c] mb-3">{albumName}</h1>
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
