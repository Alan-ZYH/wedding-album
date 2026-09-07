'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { collection, doc, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Media, Message, Settings, DEFAULT_SETTINGS, PlaybackState } from '@/types'
import DanmakuLayer from '@/components/display/DanmakuLayer'
import QrOverlay from '@/components/display/QrOverlay'

/**
 * Interleave pinned photos evenly through the carousel.
 *
 * Pinned photos occupy slots out of `size`; whatever is left goes to the
 * newest `playing` photos. Spacing follows the real ratio rather than a fixed
 * gap, so 12 pinned out of 50 lands roughly every 3rd slide while 25 out of 50
 * alternates — the rhythm stays even at any mix.
 */
function buildSequence(pinned: Media[], playing: Media[], size: number): Media[] {
  const p = pinned.slice(0, size)
  const slots = Math.max(0, size - p.length)
  const q = slots > 0 ? playing.slice(-slots) : []   // keep the newest
  if (p.length === 0) return q
  if (q.length === 0) return p

  const total = p.length + q.length
  const out: Media[] = []
  let pi = 0
  let qi = 0
  for (let i = 0; i < total; i++) {
    const due = Math.floor(((i + 1) * p.length) / total) > Math.floor((i * p.length) / total)
    if (due && pi < p.length) out.push(p[pi++])
    else if (qi < q.length) out.push(q[qi++])
    else if (pi < p.length) out.push(p[pi++])
  }
  return out
}

export default function DisplayClient() {
  const [allMedia, setAllMedia] = useState<Media[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [isController, setIsController] = useState(false)
  const [localCurrentId, setLocalCurrentId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [loading, setLoading] = useState(true)
  // Browsers need a user gesture before unmuted autoplay is allowed
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  // Videos that failed to decode this session — skipped without a DB write
  const [sessionSkipped, setSessionSkipped] = useState<Set<string>>(new Set())

  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clientIdRef = useRef<string>('')
  if (!clientIdRef.current && typeof window !== 'undefined') {
    clientIdRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36)
  }

  // ── Firestore: settings ──────────────────────────────────────
  useEffect(() => {
    if (!db) return
    return onSnapshot(
      doc(db, 'settings', 'config'),
      (snap) => { if (snap.exists()) setSettings({ ...DEFAULT_SETTINGS, ...snap.data() } as Settings) },
      () => {}
    )
  }, [])

  // ── Firestore: media (state split happens client-side) ──
  // Ordered ascending on purpose: Firestore composite indexes are
  // direction-specific and only the ascending one exists for this filter set.
  // Ordering descending here silently fails the whole query, which empties the
  // display. 800 covers a wedding comfortably.
  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'media'),
      where('status', '==', 'active'),
      where('approved', '==', true),
      orderBy('uploadTime', 'asc'),
      limit(800)
    )
    return onSnapshot(q, (snap) => {
      setAllMedia(snap.docs.map((d) => d.data() as Media))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  // ── Firestore: messages ──────────────────────────────────────
  useEffect(() => {
    if (!db) return
    const q = query(
      collection(db, 'messages'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'asc'),
      limit(500)
    )
    return onSnapshot(q, (snap) => setMessages(snap.docs.map((d) => d.data() as Message)), () => {})
  }, [])

  // ── Firestore: playback position (multi-screen sync) ─────────
  useEffect(() => {
    if (!db) return
    return onSnapshot(
      doc(db, 'display', 'playback'),
      (snap) => setPlayback(snap.exists() ? (snap.data() as PlaybackState) : null),
      () => {}
    )
  }, [])

  // ── Controller election ──────────────────────────────────────
  // Every screen offers to take over; the server only grants it when the
  // incumbent's heartbeat has gone stale, so exactly one screen drives.
  useEffect(() => {
    let cancelled = false
    const claim = async () => {
      try {
        const res = await fetch('/api/display', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'claim', clientId: clientIdRef.current }),
        })
        const data = await res.json()
        if (!cancelled) setIsController(!!data.isController)
      } catch { /* keep previous role */ }
    }
    claim()
    const t = setInterval(claim, 10_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // ── Split media by display state ─────────────────────────────
  const { pinned, playingPool, pendingQueue } = useMemo(() => {
    const usable = allMedia.filter(
      (m) => !(m.displayError && m.fileType !== 'video') && !sessionSkipped.has(m.id)
    )
    const videosOk = (m: Media) => !(m.fileType === 'video' && !settings.playVideos)
    return {
      pinned: usable
        .filter((m) => m.displayState === 'pinned' && videosOk(m))
        .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0)),
      // oldest first — the front of this list is what rule Y evicts
      playingPool: usable
        .filter((m) => m.displayState === 'playing' && videosOk(m))
        .sort((a, b) => (a.displayStateAt || '').localeCompare(b.displayStateAt || '')),
      // oldest first — the front is promoted next
      pendingQueue: usable
        .filter((m) => m.displayState === 'pending' && videosOk(m))
        .sort((a, b) => (a.displayStateAt || '').localeCompare(b.displayStateAt || '')),
    }
  }, [allMedia, settings.playVideos, sessionSkipped])

  const sequence = useMemo(
    () => buildSequence(pinned, playingPool, settings.carouselSize ?? 50),
    [pinned, playingPool, settings.carouselSize]
  )

  // Controller drives its own position; followers mirror the shared one.
  const currentMediaId = isController ? localCurrentId : playback?.currentMediaId ?? null
  const currentIndex = sequence.findIndex((m) => m.id === currentMediaId)
  const current = currentIndex >= 0 ? sequence[currentIndex] : sequence[0]
  const nextItem =
    sequence.length > 1
      ? sequence[((currentIndex < 0 ? 0 : currentIndex) + 1) % sequence.length]
      : null

  // Refs so timers can read fresh values without re-subscribing
  const seqRef = useRef(sequence);        seqRef.current = sequence
  const pendingRef = useRef(pendingQueue); pendingRef.current = pendingQueue
  const curIdRef = useRef(currentMediaId); curIdRef.current = currentMediaId
  const ctrlRef = useRef(isController);    ctrlRef.current = isController
  const allowRef = useRef(settings.allowInsert !== false)
  allowRef.current = settings.allowInsert !== false
  // Free slots in the carousel right now (pinned photos occupy slots too)
  const freeSlots = Math.max(0, (settings.carouselSize ?? 50) - pinned.length - playingPool.length)
  const freeSlotsRef = useRef(freeSlots)
  freeSlotsRef.current = freeSlots

  // ── Advance ──────────────────────────────────────────────────
  const goNext = useCallback(() => {
    const seq = seqRef.current
    if (seq.length === 0) return
    const idx = seq.findIndex((m) => m.id === curIdRef.current)
    const played = idx >= 0 ? seq[idx] : null
    const next = seq[(idx < 0 ? -1 : idx) + 1 >= seq.length ? 0 : (idx < 0 ? 0 : idx + 1)]
    setLocalCurrentId(next?.id ?? null)

    if (!ctrlRef.current) return

    // Rule Y — a photo that has had its turn steps aside for the queue, but
    // only once the pool is at capacity. While slots are free nobody needs to
    // make room; growing the pool is left to the top-up effect below.
    // Pinned photos never rotate out, and an empty queue just keeps looping.
    const queue = pendingRef.current
    const rotate =
      allowRef.current &&
      freeSlotsRef.current === 0 &&
      played?.displayState === 'playing' &&
      queue.length > 0
        ? { playedId: played.id, promoteId: queue[0].id }
        : undefined

    fetch('/api/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'advance',
        clientId: clientIdRef.current,
        currentMediaId: next?.id ?? '',
        rotate,
      }),
    }).catch(() => {})
  }, [])

  const goNextRef = useRef(goNext)
  goNextRef.current = goNext

  // An admin pressing ▶️ writes currentMediaId + jumpAt; followers mirror it
  // automatically, and the controller cuts to it here. Old jumps are ignored so
  // a screen reloading mid-event doesn't replay a stale command.
  const jumpHandledRef = useRef<string | null>(null)
  useEffect(() => {
    const jumpAt = playback?.jumpAt
    if (!jumpAt || !playback?.currentMediaId) return
    if (jumpHandledRef.current === jumpAt) return
    jumpHandledRef.current = jumpAt
    if (Date.now() - new Date(jumpAt).getTime() > 30_000) return
    if (isController) setLocalCurrentId(playback.currentMediaId)
  }, [playback?.jumpAt, playback?.currentMediaId, isController])

  // Fill empty carousel slots from the pending queue.
  //
  // Rule Y only rotates when a playing photo finishes its turn, so a pool that
  // starts empty (or gains slots because pinned photos were removed) would
  // never bootstrap. This tops it up one photo at a time until it is full.
  // Guard against re-entry by remembering which photos are already in flight.
  // A plain boolean deadlocks here: the Firestore snapshot can land before the
  // fetch resolves, so the effect re-runs while the flag is still set and then
  // never gets another dependency change to retry on.
  const fillingRef = useRef<string>('')
  useEffect(() => {
    if (!isController || !allowRef.current) return
    if (freeSlots === 0 || pendingQueue.length === 0) return

    const promoteIds = pendingQueue.slice(0, freeSlots).map((m) => m.id)
    const key = promoteIds.join(',')
    if (fillingRef.current === key) return
    fillingRef.current = key

    fetch('/api/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'advance',
        clientId: clientIdRef.current,
        currentMediaId: curIdRef.current ?? '',
        rotate: { promoteIds },   // fill every free slot, no eviction
      }),
    }).catch(() => { fillingRef.current = '' })   // allow a retry on failure
  }, [isController, freeSlots, pendingQueue])

  // Seed the position once media arrives
  useEffect(() => {
    if (isController && !localCurrentId && sequence.length > 0) {
      setLocalCurrentId(sequence[0].id)
    }
  }, [isController, localCurrentId, sequence])

  // ── Auto-advance timer (photos only; videos advance on 'ended') ──
  // Keyed on the current item's identity, never on the media array, so a guest
  // uploading mid-slide cannot restart the countdown.
  const currentSlideId = current?.id
  const currentIsVideo = current?.fileType === 'video'
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!isController || !currentSlideId) return
    if (currentIsVideo && settings.playVideos) return
    timerRef.current = setTimeout(() => goNextRef.current(), settings.slideInterval * 1000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [isController, currentSlideId, currentIsVideo, settings.slideInterval, settings.playVideos])

  const skipVideo = useCallback((id: string) => {
    setSessionSkipped((s) => new Set(s).add(id))
  }, [])

  const markDisplayError = useCallback(async (mediaId: string) => {
    try {
      await fetch(`/api/media/${mediaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayError: true }),
      })
    } catch {}
  }, [])

  // Clicking advances and unlocks audio
  const handleUserInteraction = useCallback(() => {
    setAudioUnlocked(true)
    goNextRef.current()
  }, [])

  const goPrev = () => {
    setAudioUnlocked(true)
    const seq = seqRef.current
    if (seq.length === 0) return
    const idx = seq.findIndex((m) => m.id === curIdRef.current)
    const prev = seq[(idx <= 0 ? seq.length : idx) - 1]
    setLocalCurrentId(prev?.id ?? null)
  }

  const toggleFullscreen = () => {
    setAudioUnlocked(true)
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

  // Preload the photo after next so short intervals never show a blank frame
  useEffect(() => {
    if (sequence.length < 3 || currentIndex < 0) return
    const after = sequence[(currentIndex + 2) % sequence.length]
    if (after?.fileType === 'photo') {
      const img = new Image()
      img.src = `https://lh3.googleusercontent.com/d/${after.googleDriveFileId}=w1920`
    }
  }, [currentIndex, sequence])

  const showAudioHint =
    !settings.muteVideos && !audioUnlocked && current?.fileType === 'video' && settings.playVideos

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen bg-black overflow-hidden cursor-pointer"
      onClick={handleUserInteraction}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-white">
            <div className="text-6xl mb-4 animate-pulse">💍</div>
            <p className="text-xl font-serif opacity-70">{settings.albumName || DEFAULT_SETTINGS.albumName}</p>
            <p className="text-sm opacity-40 mt-2">載入中...</p>
          </div>
        </div>
      ) : sequence.length === 0 ? (
        <WaitingScreen albumName={settings.albumName || DEFAULT_SETTINGS.albumName} />
      ) : (
        <>
          {current && (
            <Slide
              key={current.id}
              item={current}
              settings={settings}
              active={true}
              audioAllowed={audioUnlocked}
              onVideoEnd={() => goNextRef.current()}
              onMediaError={() => {
                if (current.fileType === 'video') { skipVideo(current.id); goNextRef.current() }
                else { markDisplayError(current.id); goNextRef.current() }
              }}
              transition={settings.slideTransition ?? 'fade'}
            />
          )}
          {nextItem && nextItem.id !== current?.id && (
            <Slide
              key={nextItem.id}
              item={nextItem}
              settings={settings}
              active={false}
              audioAllowed={audioUnlocked}
              onVideoEnd={() => goNextRef.current()}
              onMediaError={() => {
                // Preloading slot: never brand a photo broken before it is shown
                if (nextItem.fileType === 'video') skipVideo(nextItem.id)
              }}
              transition={settings.slideTransition ?? 'fade'}
            />
          )}
        </>
      )}

      {showAudioHint && (
        <div className="absolute bottom-20 left-0 right-0 flex justify-center z-25 pointer-events-none">
          <div className="bg-black/60 text-white/80 text-sm px-5 py-2 rounded-full animate-pulse">
            🔇 點擊螢幕以啟用聲音
          </div>
        </div>
      )}

      {settings.showQrCode !== false && (
        <QrOverlay
          position={settings.qrPosition ?? 'bottom-right'}
          size={settings.qrSize ?? 160}
        />
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
        <div className="text-white/60 text-sm font-mono flex items-center gap-3">
          {sequence.length > 0 && `${(currentIndex < 0 ? 0 : currentIndex) + 1} / ${sequence.length}`}
          {pendingQueue.length > 0 && (
            <span className="text-[#c9a84c]">待播 {pendingQueue.length}</span>
          )}
          {!isController && <span className="text-white/40">同步中</span>}
        </div>
        <button
          onClick={toggleFullscreen}
          className="text-white/70 hover:text-white bg-black/40 rounded-full px-4 py-2 text-sm transition-colors"
        >
          {isFullscreen ? '⊠ 退出全螢幕' : '⊞ 全螢幕'}
        </button>
      </div>

      {sequence.length > 1 && sequence.length <= 30 && (
        <div className="absolute bottom-0 left-0 right-0 flex gap-0.5 px-4 pb-3 opacity-30 hover:opacity-70 transition-opacity z-30">
          {sequence.map((m, i) => (
            <div
              key={m.id}
              onClick={(e) => { e.stopPropagation(); setLocalCurrentId(m.id) }}
              className={`h-0.5 flex-1 rounded-full transition-colors cursor-pointer ${
                i === currentIndex ? 'bg-[#c9a84c]' : 'bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
      {sequence.length > 30 && (
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 opacity-30 hover:opacity-70 transition-opacity z-30">
          <div className="h-0.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#c9a84c] rounded-full transition-all duration-500"
              style={{ width: `${(((currentIndex < 0 ? 0 : currentIndex) + 1) / sequence.length) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Slide component ──
function Slide({
  item,
  settings,
  active,
  audioAllowed,
  onVideoEnd,
  onMediaError,
  transition,
}: {
  item: Media
  settings: Settings
  active: boolean
  audioAllowed: boolean
  onVideoEnd: () => void
  onMediaError: () => void
  transition: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const errorReported = useRef(false)
  // Increment each time this slide becomes active to re-trigger CSS animation
  const [enterKey, setEnterKey] = useState(0)
  // True when native <video> fails (e.g. HEVC codec) — show thumbnail fallback
  const [videoLoadError, setVideoLoadError] = useState(false)

  useEffect(() => {
    errorReported.current = false
  }, [item.id])

  useEffect(() => {
    if (active) setEnterKey((k) => k + 1)
  }, [active])

  // ── Effect 1: start / stop video when active changes ──
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active) {
      // React's `muted` prop has a known bug — set the DOM property directly
      v.muted = settings.muteVideos !== false || !audioAllowed
      v.currentTime = 0
      v.play().catch(() => {
        if (!v.muted) {
          // Browser blocked unmuted autoplay (no prior user gesture).
          // Fall back to muted so video still plays; display shows a hint to click.
          v.muted = true
          v.play().catch(() => {})
        }
      })
    } else {
      v.pause()
      v.currentTime = 0
    }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: update muted in real-time when settings or audio lock change ──
  // Does NOT restart the video — only toggles the muted property on the live element.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !active) return
    v.muted = settings.muteVideos !== false || !audioAllowed
  }, [active, audioAllowed, settings.muteVideos])

  // Safety fallback: advance after 5 minutes if video never ends normally
  useEffect(() => {
    if (!active || item.fileType !== 'video' || !settings.playVideos) return
    if (videoLoadError) return  // handled by slideInterval timer below
    const timer = setTimeout(onVideoEnd, 300_000)
    return () => clearTimeout(timer)
  }, [active, item.id, item.fileType, settings.playVideos, onVideoEnd, videoLoadError])

  // When video fails to decode (HEVC fallback), auto-advance like a photo
  useEffect(() => {
    if (!active || !videoLoadError) return
    const timer = setTimeout(onVideoEnd, settings.slideInterval * 1000)
    return () => clearTimeout(timer)
  }, [active, videoLoadError, settings.slideInterval, onVideoEnd])

  // Outer: controls z-order and visibility of the preloading slot
  const outerClass = `absolute inset-0 ${active ? 'z-10' : 'z-0 pointer-events-none opacity-0'}`
  // Inner: re-keyed on each activation to replay the CSS keyframe animation
  const animClass = active ? `transition-${transition}` : ''

  const handlePhotoError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement
    if (!img.src.includes('thumbnail')) {
      img.src = `https://drive.google.com/thumbnail?id=${item.googleDriveFileId}&sz=w1920`
    } else if (!errorReported.current) {
      errorReported.current = true
      onMediaError()
    }
  }

  if (item.fileType === 'video' && settings.playVideos) {
    // Use our short-lived redirect endpoint for videos. Direct lh3 links are
    // reliable for photos but not consistently playable as video streams.
    const videoSrc = `/api/video/${item.googleDriveFileId}`
    return (
      <div className={outerClass}>
        <div key={enterKey} className={`absolute inset-0 flex items-center justify-center bg-black ${animClass}`}>
          {videoLoadError ? (
            // Fallback: show thumbnail + codec notice, auto-advance via slideInterval timer
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://drive.google.com/thumbnail?id=${item.googleDriveFileId}&sz=w1920`}
                alt={item.fileName}
                className="max-w-full max-h-full object-contain opacity-40"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <span className="text-5xl">🎬</span>
                <p className="text-white/70 text-sm">影片格式不相容（HEVC）</p>
                <p className="text-white/40 text-xs">請以 Safari 開啟投放頁面以播放此影片</p>
              </div>
            </>
          ) : (
            <video
              ref={videoRef}
              src={videoSrc}
              playsInline
              preload={active ? 'auto' : 'none'}
              onEnded={onVideoEnd}
              onError={() => setVideoLoadError(true)}
              className="w-full h-full object-contain"
            />
          )}
          {settings.showGuestName && active && <GuestNameBadge name={item.guestName} />}
        </div>
      </div>
    )
  }

  return (
    <div className={outerClass}>
      <div key={enterKey} className={`absolute inset-0 flex items-center justify-center bg-black ${animClass}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://lh3.googleusercontent.com/d/${item.googleDriveFileId}=w1920`}
          alt={item.fileName}
          className="max-w-full max-h-full object-contain"
          onError={handlePhotoError}
        />
        {settings.showGuestName && active && <GuestNameBadge name={item.guestName} />}
      </div>
    </div>
  )
}

function GuestNameBadge({ name }: { name: string }) {
  // Bottom centre: the corners are where the QR overlay lives, and centring
  // reads as a caption for the photo rather than a stray label.
  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20">
      <div className="bg-black/50 backdrop-blur-sm text-white/90 text-lg px-6 py-2 rounded-full whitespace-nowrap">
        {name}
      </div>
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

