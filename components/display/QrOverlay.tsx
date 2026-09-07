'use client'

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { QrPosition } from '@/types'

const CORNERS: Record<QrPosition, string> = {
  'top-left': 'top-6 left-6',
  'top-right': 'top-6 right-6',
  'bottom-left': 'left-6',
  'bottom-right': 'right-6',
}

/** Clears the mobile browser toolbar and the iPhone home indicator. */
const BOTTOM_SAFE = 'calc(1.5rem + env(safe-area-inset-bottom, 0px))'

/**
 * Standing invitation on the projection screen: guests who arrive late, or who
 * only think to join once they see the slideshow, can scan without hunting for
 * a table card.
 */
export default function QrOverlay({
  position,
  size,
}: {
  position: QrPosition
  size: number
}) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    const url = `${window.location.origin}/guest`
    // Render at 2x for crisp projection on large screens
    QRCode.toDataURL(url, {
      width: Math.max(320, size * 2),
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#3d2f14', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => {})
  }, [size])

  if (!dataUrl) return null

  const isBottom = position.startsWith('bottom')
  return (
    <div
      className={`absolute ${CORNERS[position] ?? CORNERS['bottom-right']} z-20 pointer-events-none`}
      style={isBottom ? { bottom: BOTTOM_SAFE } : undefined}
    >
      <div className="bg-white/95 rounded-2xl p-2.5 shadow-lg shadow-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt="上傳照片 QR Code" width={size} height={size} className="block" />
        <p
          className="text-center text-[#7a5c2e] font-medium mt-1"
          style={{ fontSize: Math.max(10, size * 0.075) }}
        >
          掃描分享照片
        </p>
      </div>
    </div>
  )
}
