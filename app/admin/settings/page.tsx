'use client'

import { useState, useEffect } from 'react'
import { Settings, DEFAULT_SETTINGS, SlideTransition, DanmakuStyle } from '@/types'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success) setSettings(d.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (data.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch {}
    finally { setSaving(false) }
  }

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  if (loading) return <div className="text-center py-16 text-gray-400">載入中...</div>

  return (
    <div className="max-w-2xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-serif text-gray-800">投放設定</h1>
          <p className="text-sm text-gray-400">變更後立即套用至投放端</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
            saving
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : saved
              ? 'bg-green-500 text-white'
              : 'bg-[#c9a84c] hover:bg-[#b8953d] text-white'
          }`}
        >
          {saving ? '儲存中...' : saved ? '✓ 已儲存' : '儲存設定'}
        </button>
      </div>

      <div className="space-y-4">
        {/* Album name */}
        <Section title="相簿設定" icon="📛">
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">活動名稱</p>
              <p className="text-xs text-gray-400 mt-0.5">顯示在賓客端頁面頂端</p>
            </div>
            <input
              type="text"
              value={settings.albumName ?? '婚禮紀念相簿'}
              onChange={(e) => update('albumName', e.target.value)}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#c9a84c] w-56"
              placeholder="婚禮紀念相簿"
            />
          </div>
        </Section>

        {/* Slideshow section */}
        <Section title="幻燈片設定" icon="🎞️">
          <SliderField
            label="幻燈片間隔（秒）"
            min={2} max={30} step={1}
            value={settings.slideInterval}
            onChange={(v) => update('slideInterval', v)}
            display={`${settings.slideInterval} 秒`}
          />
          <TransitionField
            value={settings.slideTransition}
            onChange={(v) => update('slideTransition', v)}
          />
          <ToggleField
            label="顯示上傳者名稱"
            description={`例：「Photo by 王小明」`}
            value={settings.showGuestName}
            onChange={(v) => update('showGuestName', v)}
          />
          <ToggleField
            label="需要審核才顯示"
            description="開啟後媒體須通過管理員審核才出現在投放端"
            value={settings.requireApproval}
            onChange={(v) => update('requireApproval', v)}
          />
        </Section>

        {/* Carousel pool */}
        <Section title="輪播池設定" icon="🎠">
          <SliderField
            label="輪播照片數量"
            min={20} max={100} step={5}
            value={settings.carouselSize ?? 50}
            onChange={(v) => update('carouselSize', v)}
            display={`${settings.carouselSize ?? 50} 張`}
          />
          <p className="text-xs text-gray-400 -mt-2">
            置頂照片會佔用這個額度。置頂張數越多，待播照片遞補得越慢。
          </p>
          <ToggleField
            label="允許插播"
            description="關閉後，賓客新上傳的照片會停在「待播」不上大螢幕；重新開啟時依序遞補"
            value={settings.allowInsert !== false}
            onChange={(v) => update('allowInsert', v)}
          />
        </Section>

        {/* Video section */}
        <Section title="影片設定" icon="🎬">
          <ToggleField
            label="播放影片"
            description="開啟後影片會在投放端播放"
            value={settings.playVideos}
            onChange={(v) => update('playVideos', v)}
          />
          <ToggleField
            label="影片靜音"
            description="建議開啟以避免婚禮現場音效干擾"
            value={settings.muteVideos}
            onChange={(v) => update('muteVideos', v)}
          />
        </Section>

        {/* Danmaku section */}
        <Section title="彈幕設定" icon="💬">
          <ToggleField
            label="顯示彈幕"
            description="在投放端顯示賓客祝福的滾動彈幕"
            value={settings.showDanmaku}
            onChange={(v) => update('showDanmaku', v)}
          />
          <DanmakuStyleField
            value={settings.danmakuStyle}
            onChange={(v) => update('danmakuStyle', v)}
          />
          <SliderField
            label="彈幕速度"
            min={1} max={5} step={1}
            value={settings.danmakuSpeed}
            onChange={(v) => update('danmakuSpeed', v)}
            display={['很慢', '慢', '適中', '快', '很快'][settings.danmakuSpeed - 1]}
          />
          <SliderField
            label="彈幕密度"
            min={1} max={5} step={1}
            value={settings.danmakuDensity}
            onChange={(v) => update('danmakuDensity', v)}
            display={['很疏', '疏', '適中', '密', '很密'][settings.danmakuDensity - 1]}
          />
          <SliderField
            label="彈幕字體大小"
            min={16} max={48} step={2}
            value={settings.danmakuFontSize}
            onChange={(v) => update('danmakuFontSize', v)}
            display={`${settings.danmakuFontSize}px`}
          />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="text-base font-medium text-gray-700 mb-4 flex items-center gap-2">
        <span>{icon}</span> {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function ToggleField({
  label, description, value, onChange,
}: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-[#c9a84c]' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  )
}

function DanmakuStyleField({
  value, onChange,
}: {
  value: DanmakuStyle
  onChange: (v: DanmakuStyle) => void
}) {
  const options: { value: DanmakuStyle; label: string; desc: string }[] = [
    { value: 'scroll',         label: '右→左捲動', desc: '由右飄向左' },
    { value: 'scroll-reverse', label: '左→右捲動', desc: '由左飄向右' },
    { value: 'float',          label: '浮起消失',  desc: '原地往上淡出' },
    { value: 'fade',           label: '淡入淡出',  desc: '原地停留消失' },
  ]
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">彈幕動畫形式</p>
      <div className="grid grid-cols-4 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-xl border py-2 px-1 text-center transition-all ${
              value === opt.value
                ? 'border-[#c9a84c] bg-[#c9a84c]/10 text-[#c9a84c]'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            <p className="text-xs font-medium">{opt.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function TransitionField({
  value, onChange,
}: {
  value: SlideTransition
  onChange: (v: SlideTransition) => void
}) {
  const options: { value: SlideTransition; label: string; desc: string }[] = [
    { value: 'fade',  label: '淡入縮放', desc: '柔和放大淡入' },
    { value: 'slide', label: '滑入',     desc: '從右側滑入' },
    { value: 'zoom',  label: '縮放',     desc: '明顯放大縮放' },
    { value: 'none',  label: '無動畫',   desc: '直接切換' },
  ]
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">過場動畫</p>
      <div className="grid grid-cols-4 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-xl border py-2 px-1 text-center transition-all ${
              value === opt.value
                ? 'border-[#c9a84c] bg-[#c9a84c]/10 text-[#c9a84c]'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            <p className="text-xs font-medium">{opt.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function SliderField({
  label, min, max, step, value, onChange, display,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  display: string
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <span className="text-sm text-[#c9a84c] font-medium">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#c9a84c]"
      />
      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
