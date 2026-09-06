'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'

/** Print-resolution QR bitmap (px). 1024 is ample for an A6 table card. */
const QR_PX = 1024
/** Table-card canvas — 3:4 portrait, sized for crisp printing. */
const CARD_W = 1200
const CARD_H = 1600
const GOLD = '#c9a84c'
const INK = '#7a5c2e'

/**
 * Renders the guest-entry QR code and offers two downloads:
 * a bare PNG for designers, and a ready-to-print table card.
 */
export default function QrCodePanel({ albumName }: { albumName: string }) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setUrl(`${window.location.origin}/guest`)
  }, [])

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
      .then(setPreview)
      .catch(() => {})
  }, [url])

  const saveCanvas = (canvas: HTMLCanvasElement, filename: string) => {
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = filename
    a.click()
  }

  // ── Plain high-resolution QR ────────────────────────────────
  const downloadPlain = useCallback(async () => {
    setBusy('plain')
    try {
      const canvas = document.createElement('canvas')
      await QRCode.toCanvas(canvas, url, {
        width: QR_PX,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      })
      saveCanvas(canvas, '婚禮相簿_QRCode.png')
    } finally { setBusy(null) }
  }, [url])

  // ── Composed table card ─────────────────────────────────────
  const downloadCard = useCallback(async () => {
    setBusy('card')
    try {
      const qr = document.createElement('canvas')
      await QRCode.toCanvas(qr, url, {
        width: 760,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#3d2f14', light: '#ffffff' },
      })

      const canvas = document.createElement('canvas')
      canvas.width = CARD_W
      canvas.height = CARD_H
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Cream ground with a thin gold frame
      ctx.fillStyle = '#fdf8f0'
      ctx.fillRect(0, 0, CARD_W, CARD_H)
      ctx.strokeStyle = GOLD
      ctx.lineWidth = 6
      ctx.strokeRect(48, 48, CARD_W - 96, CARD_H - 96)

      ctx.textAlign = 'center'

      ctx.fillStyle = INK
      ctx.font = '600 84px "Noto Serif TC", Georgia, serif'
      ctx.fillText(albumName || '婚禮紀念相簿', CARD_W / 2, 260)

      // Divider
      ctx.strokeStyle = GOLD
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(CARD_W / 2 - 180, 320)
      ctx.lineTo(CARD_W / 2 + 180, 320)
      ctx.stroke()

      ctx.fillStyle = GOLD
      ctx.font = '44px Georgia, serif'
      ctx.fillText('掃描分享您的照片與祝福', CARD_W / 2, 400)

      // QR on a white plate
      const qx = (CARD_W - qr.width) / 2
      const qy = 470
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(qx - 28, qy - 28, qr.width + 56, qr.height + 56)
      ctx.drawImage(qr, qx, qy)

      ctx.fillStyle = INK
      ctx.font = '46px "Noto Sans TC", sans-serif'
      ctx.fillText('① 掃描 QR Code', CARD_W / 2, qy + qr.height + 130)
      ctx.fillText('② 輸入您的名字', CARD_W / 2, qy + qr.height + 200)
      ctx.fillText('③ 上傳照片、留下祝福', CARD_W / 2, qy + qr.height + 270)

      ctx.fillStyle = GOLD
      ctx.font = '38px Georgia, serif'
      ctx.fillText('您的照片將即時出現在大螢幕上 ♡', CARD_W / 2, CARD_H - 150)

      saveCanvas(canvas, '婚禮相簿_桌卡.png')
    } finally { setBusy(null) }
  }, [url, albumName])

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
      <h2 className="text-base font-medium text-gray-700 mb-3 flex items-center gap-2">
        <span>📱</span> 賓客 QR Code
      </h2>

      <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
        <div className="shrink-0 bg-white border border-gray-200 rounded-xl p-3">
          {preview
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview} alt="賓客端 QR Code" width={160} height={160} />
            : <div className="w-40 h-40 bg-gray-50 animate-pulse rounded" />}
        </div>

        <div className="flex-1 w-full">
          <p className="text-xs text-gray-500 mb-1">賓客掃描後直接進入上傳頁</p>
          <code className="block bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 truncate mb-3">
            {url || '載入中...'}
          </code>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadCard}
              disabled={!url || busy !== null}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                busy || !url
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
              }`}
            >
              {busy === 'card' ? '產生中...' : '⬇ 下載桌卡（可直接印）'}
            </button>
            <button
              onClick={downloadPlain}
              disabled={!url || busy !== null}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                busy || !url
                  ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                  : 'border-[#c9a84c] text-[#7a5c2e] hover:bg-[#c9a84c]/10'
              }`}
            >
              {busy === 'plain' ? '產生中...' : '⬇ 下載純 QR Code'}
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-2.5 leading-relaxed">
            桌卡為 1200×1600 直式，含活動名稱與操作說明，可直接送印（建議 A6 或 A5）。<br />
            純 QR Code 為 1024×1024 去背白底，適合自行排版設計。
          </p>
        </div>
      </div>
    </div>
  )
}
