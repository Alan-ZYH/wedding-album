'use client'

/**
 * Browser → Google Drive upload over a resumable session, in chunks.
 *
 * Drive answers the site's origin with CORS headers on the upload itself, so
 * the browser gets real progress events and reads the finished file's id —
 * provided the session was created with the site's Origin (init does). Without
 * it Drive sends the headers on the intermediate 308s but not on the final 200,
 * so the upload lands and the browser still reports a network error. If that
 * ever happens, FinalResponseUnreadable lets the server find the file by name.
 * Two properties of Drive's resumable protocol, both checked, shape the rest:
 *
 *  - Resending bytes Drive already holds is accepted and does not move its
 *    progress back. So after a dropped connection the upload continues from the
 *    last chunk the browser saw acknowledged, without asking Drive how far it
 *    got — which the browser could not read anyway, since Drive does not
 *    expose its Range header.
 *  - Every chunk but the last must be a multiple of 256 KiB.
 */

const CHUNK = 8 * 1024 * 1024 // 32 × 256 KiB

export interface DriveSession {
  uploadUrl: string
  /** Bytes Drive has acknowledged; where a retry continues from */
  sent: number
}

export class UploadAborted extends Error {}

/**
 * The last chunk was sent but its response could not be read. Drive has most
 * likely finished the file, so the caller should let the server look for it by
 * name rather than report a failure.
 */
export class FinalResponseUnreadable extends Error {}

function putChunk(
  url: string,
  file: Blob,
  start: number,
  end: number, // exclusive
  total: number,
  mime: string,
  onBytes: (loaded: number) => void
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`)
    xhr.upload.onprogress = (e) => onBytes(e.loaded)
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
    xhr.onerror = () => reject(new UploadAborted('network'))
    xhr.onabort = () => reject(new UploadAborted('abort'))
    // Nothing for two minutes on one chunk is a stalled connection, not a slow one
    xhr.timeout = 120_000
    xhr.ontimeout = () => reject(new UploadAborted('timeout'))
    xhr.send(file.slice(start, end))
  })
}

/**
 * Upload `file` into `session`, continuing from `session.sent`. Resolves with
 * Drive's file id. Throws UploadAborted when the connection drops — the session
 * keeps its progress, so calling again resumes.
 */
export async function uploadToDrive(
  session: DriveSession,
  file: File,
  mime: string,
  onProgress: (fraction: number) => void
): Promise<string> {
  const total = file.size
  while (true) {
    const start = session.sent
    const end = Math.min(start + CHUNK, total)
    let sentAll = false
    let res: { status: number; body: string }
    try {
      res = await putChunk(session.uploadUrl, file, start, end, total, mime, (loaded) => {
        if (end === total && loaded >= end - start) sentAll = true
        onProgress(Math.min(1, (start + loaded) / total))
      })
    } catch (err) {
      // Every byte of the final chunk went out; only the answer is missing
      if (sentAll) throw new FinalResponseUnreadable()
      throw err
    }

    if (res.status === 200 || res.status === 201) {
      session.sent = total
      onProgress(1)
      try {
        const id = JSON.parse(res.body).id
        if (typeof id === 'string') return id
      } catch { /* fall through */ }
      return '' // uploaded, id unreadable — the server finds it by name
    }
    if (res.status === 308) {
      session.sent = end
      continue
    }
    // 4xx/5xx other than the protocol's 308: the session itself is refused
    throw new Error(`Drive ${res.status}`)
  }
}

/** Type from the extension when the browser supplies none (common for HEIC and MOV). */
export function mimeOf(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return (
    {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      heic: 'image/heic', heif: 'image/heif',
      mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp', webm: 'video/webm',
    } as Record<string, string>
  )[ext] ?? ''
}

/**
 * A still from the first moment of a video, as a small data URL — or null when
 * this browser cannot decode it (Chrome on many Android phones cannot play the
 * HEVC video iPhones record). Bounded by a timeout so one stubborn file cannot
 * hold up the rest.
 */
export function videoThumbnail(file: File, width = 240): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 5000)
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onloadeddata = () => {
      try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2) } catch { finish(null) }
    }
    video.onseeked = () => {
      try {
        const h = Math.round((video.videoHeight / video.videoWidth) * width) || width
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = h
        canvas.getContext('2d')?.drawImage(video, 0, 0, width, h)
        clearTimeout(timer)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch { finish(null) }
    }
    video.onerror = () => { clearTimeout(timer); finish(null) }
    video.src = url
  })
}
