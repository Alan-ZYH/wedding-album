'use client'

import { useState, useEffect, useRef } from 'react'
import { Message, DanmakuStyle } from '@/types'

interface Props {
  /** The rotation — pinned and playing blessings, all of which have flown */
  messages: Message[]
  /** Queued blessings, flown first, lowest queueOrder first */
  queue: Message[]
  /** Called as a queued blessing takes off; the controlling screen reports it */
  onFlown?: (id: string) => void
  speed: number      // 1-5
  density: number    // 1-5
  fontSize: number   // px
  danmakuStyle: DanmakuStyle
}

interface DanmakuItem {
  id: string
  text: string
  top: number
  left: number   // % for float/fade; 0 for scroll styles
  duration: number
  color: string
  /** Drawn on a tinted plate — a blessing the couple sent with a colour */
  plate: boolean
}

const COLORS = [
  '#f5e0a0',
  '#ffd700',
  '#ffe4b5',
  '#fff8dc',
  '#faebd7',
  '#ffffff',
  '#e8d5a3',
]

const MAX_ACTIVE_DANMAKU = 60

/** A queued blessing not yet promoted this long after flying is flown again —
 *  the report may have been lost, or a new screen taken over control. */
const REFLY_AFTER_MS = 30_000

export default function DanmakuLayer({ messages, queue, onFlown, speed, density, fontSize, danmakuStyle }: Props) {
  const [active, setActive] = useState<DanmakuItem[]>([])
  const poolRef = useRef<Message[]>([])
  const queueRef = useRef<Message[]>([])
  queueRef.current = queue
  const onFlownRef = useRef(onFlown)
  onFlownRef.current = onFlown
  // When each queued blessing last took off from this screen
  const flownAtRef = useRef<Map<string, number>>(new Map())
  const channelsRef = useRef<number[]>([]) // track occupied y positions
  const activeCountRef = useRef(0) // mirrors active.length for use inside timers
  const numChannels = 8

  useEffect(() => {
    activeCountRef.current = active.length
  }, [active.length])

  useEffect(() => {
    if (messages.length === 0) { poolRef.current = []; return }

    // Build weighted pool (priority messages appear more)
    const pool: Message[] = []
    for (const msg of messages) {
      const weight = msg.priority === 2 ? 3 : 1
      for (let i = 0; i < weight; i++) pool.push(msg)
    }
    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    poolRef.current = pool
  }, [messages])

  // The spawn loop reads poolRef, so it does NOT depend on `messages` itself —
  // otherwise every new blessing would tear down and restart the interval,
  // delaying the next danmaku each time guests post in quick succession.
  const hasMessages = messages.length + queue.length > 0

  useEffect(() => {
    if (!hasMessages) return

    // density: 1=sparse, 5=dense → interval in ms
    // speed: 1=slow(12s), 5=fast(5s)
    const intervalMs = Math.round(8000 / density)
    const baseDuration = Math.round(14000 - speed * 1800) // 5s-12s

    let poolIndex = 0

    const fire = () => {
      // Cap concurrent danmaku DOM nodes — protects the display device
      // during long events with many messages
      if (activeCountRef.current >= MAX_ACTIVE_DANMAKU) return

      // The queue goes first: a blessing waiting its turn is one nobody has
      // seen yet. The rotation only plays once the queue is clear.
      const now = Date.now()
      const flown = flownAtRef.current
      for (const id of [...flown.keys()]) {
        if (!queueRef.current.some((m) => m.id === id)) flown.delete(id)
      }
      const queued = queueRef.current.find((m) => {
        const at = flown.get(m.id)
        return at === undefined || now - at > REFLY_AFTER_MS
      })

      let msg: Message
      if (queued) {
        msg = queued
        flown.set(queued.id, now)
        onFlownRef.current?.(queued.id)
      } else {
        if (poolRef.current.length === 0) return
        msg = poolRef.current[poolIndex++ % poolRef.current.length]
      }

      // Find free channel
      const usedChannels = channelsRef.current
      let channel = Math.floor(Math.random() * numChannels)
      // Try to find unused channel
      for (let attempts = 0; attempts < numChannels; attempts++) {
        if (!usedChannels.includes(channel)) break
        channel = (channel + 1) % numChannels
      }

      const topPct = 8 + (channel / numChannels) * 82 // 8% to 90%
      const duration = baseDuration + Math.random() * 3000 // ±3s variation
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      // float/fade: random horizontal position; scroll styles: edge-anchored (left=0)
      const isStatic = danmakuStyle === 'float' || danmakuStyle === 'fade'
      const leftPct = isStatic ? 5 + Math.random() * 70 : 0

      const item: DanmakuItem = {
        id: `${Date.now()}-${Math.random()}`,
        text: `${msg.guestName}：${msg.message}`,
        top: topPct,
        left: leftPct,
        duration: duration + Math.random() * 2000,
        // The colour travels with the blessing, fixed when it was sent
        color: msg.color ?? color,
        plate: !!msg.color,
      }

      channelsRef.current = [...usedChannels, channel]
      setActive((prev) => [...prev, item])

      // Remove after animation
      setTimeout(() => {
        setActive((prev) => prev.filter((a) => a.id !== item.id))
        channelsRef.current = channelsRef.current.filter((c) => c !== channel)
      }, duration + 500)
    }

    const interval = setInterval(fire, intervalMs)
    // Fire one immediately
    setTimeout(fire, 500)

    return () => clearInterval(interval)
  }, [hasMessages, speed, density, danmakuStyle])

  return (
    <div className="danmaku-container pointer-events-none">
      {active.map((item) => {
        // Custom properties don't fit CSSProperties, so the style object is
        // assembled first and cast once.
        const style = {
          top: `${item.top}%`,
          left: `${item.left}%`,
          fontSize: `${fontSize}px`,
          color: item.color,
          fontFamily: 'Georgia, serif',
          '--duration': `${item.duration}ms`,
          // The couple's blessings get a tinted plate rather than the plain
          // outline every other message uses, so they read as "from us"
          // without needing a label.
          ...(item.plate
            ? {
                padding: `${Math.round(fontSize * 0.28)}px ${Math.round(fontSize * 0.7)}px`,
                borderRadius: '999px',
                backgroundColor: `${item.color}26`,
                border: `1px solid ${item.color}66`,
                boxShadow: `0 0 ${Math.round(fontSize * 0.9)}px ${item.color}40`,
                backdropFilter: 'blur(4px)',
                fontWeight: 500,
              }
            : {
                textShadow: '1px 1px 3px rgba(0,0,0,0.8), -1px -1px 3px rgba(0,0,0,0.8)',
              }),
        } as unknown as React.CSSProperties

        return (
          <div
            key={item.id}
            className={`danmaku-item danmaku-${danmakuStyle}`}
            style={style}
          >
            {item.text}
          </div>
        )
      })}
    </div>
  )
}
