'use client'

import { useCallback, useEffect, useState } from 'react'
import { MISSIONS, Mission } from '@/lib/missions'

const NAME_KEY = 'wedding_mission_name'
const MINE_KEY = 'wedding_mission_done'

type Step = 'name' | 'list' | 'upload' | 'done'

export default function MissionPage() {
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [mission, setMission] = useState<Mission | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [mine, setMine] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  // Returning guests skip the name screen; the phone remembers who they are.
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
    const saved = localStorage.getItem(NAME_KEY)
    if (saved) {
      setName(saved)
      setStep('list')
    }
    try {
      setMine(JSON.parse(localStorage.getItem(MINE_KEY) || '[]'))
    } catch {
      /* ignore */
    }
  }, [])

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/mission/status', { cache: 'no-store' })
      const data = await res.json()
      if (data?.counts) setCounts(data.counts)
    } catch {
      /* the list still works without the ✓ marks */
    }
  }, [])

  useEffect(() => {
    if (step === 'list') refreshCounts()
  }, [step, refreshCounts])

  const submitName = (e: React.FormEvent) => {
    e.preventDefault()
    const value = nameInput.trim().slice(0, 20)
    if (!value) return
    localStorage.setItem(NAME_KEY, value)
    setName(value)
    setStep('list')
  }

  const openMission = (m: Mission) => {
    setMission(m)
    setFiles([])
    setError('')
    setProgress(0)
    setStep('upload')
    window.scrollTo(0, 0)
  }

  const upload = async () => {
    if (!mission || files.length === 0) return
    setUploading(true)
    setError('')
    setProgress(0)

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]

        const initRes = await fetch('/api/mission/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            missionId: mission.id,
            guestName: name,
            mimeType: file.type,
            fileSize: file.size,
            originalName: file.name,
          }),
        })
        const init = await initRes.json()
        if (!init.success) throw new Error(init.error || '上傳初始化失敗')

        // PUT the bytes straight to Drive — XHR, because fetch gives no
        // upload progress and a 100 MB video needs a moving bar.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', init.uploadUrl, true)
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
          xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable) return
            const done = (i + ev.loaded / ev.total) / files.length
            setProgress(Math.round(done * 100))
          }
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`上傳失敗（${xhr.status}）`))
          xhr.onerror = () => reject(new Error('網路中斷，請重試'))
          xhr.send(file)
        })
      }

      const updated = Array.from(new Set([...mine, mission.id]))
      setMine(updated)
      localStorage.setItem(MINE_KEY, JSON.stringify(updated))
      setCounts((c) => ({ ...c, [mission.id]: (c[mission.id] || 0) + files.length }))
      setProgress(100)
      setStep('done')
      window.scrollTo(0, 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上傳失敗，請重試')
    } finally {
      setUploading(false)
    }
  }

  const backToList = () => {
    setMission(null)
    setFiles([])
    setStep('list')
    refreshCounts()
    window.scrollTo(0, 0)
  }

  const isDone = (m: Mission) => (counts[m.id] || 0) > 0 || mine.includes(m.id)
  const doneCount = MISSIONS.filter(isDone).length

  return (
    <main className="min-h-screen bg-rose-50 text-stone-800">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        <header className="mb-5 text-center">
          <h1 className="text-2xl font-bold tracking-wide">婚禮闖關任務</h1>
          <p className="mt-1 text-sm text-stone-500">拍好照片影片，上傳給新人</p>
        </header>

        {/* ── 1. 輸入名稱 ─────────────────────────── */}
        {step === 'name' && (
          <form onSubmit={submitName} className="rounded-2xl bg-white p-5 shadow-sm">
            <label className="block text-base font-semibold">請先輸入你的名稱</label>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="例：小明"
              maxLength={20}
              className="mt-3 w-full rounded-xl border border-stone-300 px-4 py-3 text-lg outline-none focus:border-rose-400"
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="mt-4 w-full rounded-xl bg-rose-500 py-3.5 text-lg font-semibold text-white disabled:bg-stone-300"
            >
              開始闖關
            </button>
          </form>
        )}

        {/* ── 2. 任務清單 ─────────────────────────── */}
        {step === 'list' && (
          <>
            <div className="mb-3 flex items-center justify-between px-1 text-sm">
              <span>
                你好，<span className="font-semibold">{name}</span>
                <button
                  onClick={() => {
                    localStorage.removeItem(NAME_KEY)
                    setNameInput('')
                    setStep('name')
                  }}
                  className="ml-2 text-stone-400 underline"
                >
                  換人
                </button>
              </span>
              <span className="text-stone-500">
                已完成 {doneCount}/{MISSIONS.length}
              </span>
            </div>

            <ul className="space-y-2">
              {MISSIONS.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => openMission(m)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition ${
                      isDone(m) ? 'border-emerald-200 bg-emerald-50' : 'border-transparent bg-white'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        isDone(m) ? 'bg-emerald-500 text-white' : 'bg-rose-100 text-rose-600'
                      }`}
                    >
                      {m.label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium leading-snug">{m.title}</span>
                      {m.detail && (
                        <span className="mt-0.5 block text-xs text-stone-500">{m.detail}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-emerald-600">
                      {isDone(m) ? '✓ 完成' : '›'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── 3. 上傳 ─────────────────────────────── */}
        {step === 'upload' && mission && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <button onClick={backToList} className="text-sm text-stone-400">
              ‹ 回任務清單
            </button>
            <h2 className="mt-3 text-lg font-bold leading-snug">
              <span className="mr-2 rounded-full bg-rose-100 px-2.5 py-1 text-sm text-rose-600">
                {mission.label}
              </span>
              {mission.title}
            </h2>
            {mission.detail && <p className="mt-2 text-sm text-stone-500">{mission.detail}</p>}

            <label className="mt-5 block cursor-pointer rounded-xl border-2 border-dashed border-rose-200 bg-rose-50 py-8 text-center">
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []).slice(0, 5))
                  setError('')
                }}
              />
              <span className="text-base font-semibold text-rose-600">📷 選擇照片／影片</span>
              <span className="mt-1 block text-xs text-stone-500">可一次選最多 5 個</span>
            </label>

            {files.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-stone-600">
                {files.map((f) => (
                  <li key={f.name} className="truncate">
                    • {f.name}（{(f.size / 1024 / 1024).toFixed(1)} MB）
                  </li>
                ))}
              </ul>
            )}

            {uploading && (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
                  <div
                    className="h-full bg-rose-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-center text-sm text-stone-500">上傳中 {progress}%</p>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              onClick={upload}
              disabled={uploading || files.length === 0}
              className="mt-4 w-full rounded-xl bg-rose-500 py-3.5 text-lg font-semibold text-white disabled:bg-stone-300"
            >
              {uploading ? '上傳中…' : '上傳'}
            </button>
          </div>
        )}

        {/* ── 4. 完成 ─────────────────────────────── */}
        {step === 'done' && mission && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <div className="text-5xl">🎉</div>
            <h2 className="mt-3 text-xl font-bold text-emerald-600">上傳完成！</h2>
            <p className="mt-2 text-stone-600">
              {mission.label}　{mission.title}
            </p>
            <button
              onClick={backToList}
              className="mt-6 w-full rounded-xl bg-rose-500 py-3.5 text-lg font-semibold text-white"
            >
              回任務清單
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
