'use client'

import { useState, useEffect, useRef } from 'react'
import { Message, DanmakuStyle } from '@/types'

interface Props {
  messages: Message[]
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

export default function DanmakuLayer({ messages, speed, density, fontSize, danmakuStyle }: Props) {
  const [active, setActive] = useState<DanmakuItem[]>([])
  const poolRef = useRef<Message[]>([])
  const channelsRef = useRef<number[]>([]) // track occupied y positions
  const activeCountRef = useRef(0) // mirrors active.length for use inside timers
  const numChannels = 8

  useEffect(() => {
    activeCountRef.current = active.length
  }, [active.length])

  useEffect(() => {
    if (messages.length === 0) return

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
  const hasMessages = messages.length > 0
  useEffect(() => {
    if (!hasMessages) return

    // density: 1=sparse, 5=dense → interval in ms
    // speed: 1=slow(12s), 5=fast(5s)
    const intervalMs = Math.round(8000 / density)
    const baseDuration = Math.round(14000 - speed * 1800) // 5s-12s

    let poolIndex = 0

    const fire = () => {
      if (poolRef.current.length === 0) return
      // Cap concurrent danmaku DOM nodes — protects the display device
      // during long events with many messages
      if (activeCountRef.current >= MAX_ACTIVE_DANMAKU) return

      const msg = poolRef.current[poolIndex % poolRef.current.length]
      poolIndex++

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
        color,
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
      {active.map((item) => (
        <div
          key={item.id}
          className={`danmaku-item danmaku-${danmakuStyle}`}
          style={{
            top: `${item.top}%`,
            left: `${item.left}%`,
            fontSize: `${fontSize}px`,
            color: item.color,
            textShadow: '1px 1px 3px rgba(0,0,0,0.8), -1px -1px 3px rgba(0,0,0,0.8)',
            fontFamily: 'Georgia, serif',
            '--duration': `${item.duration}ms`,
          } as React.CSSProperties}
        >
          {item.text}
        </div>
      ))}
    </div>
  )
}
