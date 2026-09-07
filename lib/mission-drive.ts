import { google } from 'googleapis'
import { getAuth } from './google-drive'
import { MISSIONS, Mission } from './missions'

// The 闖關任務 files live in their own Drive folder, separate from the album.
// Managing them means opening that folder in Drive — there is no admin UI.
const MISSION_ROOT = process.env.MISSION_DRIVE_FOLDER_ID!

function drive() {
  return google.drive({ version: 'v3', auth: getAuth() })
}

// folder name -> folder id. Process-local; folders are created once and never
// renamed, so a stale entry is not a concern.
const folderIds: Record<string, string> = {}

function escapeName(name: string) {
  return name.replace(/'/g, "\\'")
}

export async function getMissionFolderId(mission: Mission): Promise<string> {
  const cached = folderIds[mission.folder]
  if (cached) return cached

  const d = drive()
  const res = await d.files.list({
    q: `name='${escapeName(mission.folder)}' and '${MISSION_ROOT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  let id = res.data.files?.[0]?.id
  if (!id) {
    const created = await d.files.create({
      requestBody: {
        name: mission.folder,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [MISSION_ROOT],
      },
      fields: 'id',
      supportsAllDrives: true,
    })
    id = created.data.id!
  }

  folderIds[mission.folder] = id
  return id
}

// Create every mission folder up front so the couple sees the full structure
// in Drive before the wedding, not only the tasks someone happened to upload to.
export async function ensureAllMissionFolders(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  // Sequential on purpose: parallel creates can race into duplicate folders.
  for (const m of MISSIONS) {
    out[m.id] = await getMissionFolderId(m)
  }
  return out
}

export async function createMissionUploadSession(
  mission: Mission,
  fileName: string,
  mimeType: string,
  fileSize: number
): Promise<string> {
  const auth = getAuth()
  const token = await auth.getAccessToken()
  if (!token) throw new Error('Failed to obtain Google access token')

  const folderId = await getMissionFolderId(mission)

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
    }
  )

  if (!res.ok) throw new Error(`Drive resumable session failed: ${res.status} ${await res.text()}`)

  const uploadUrl = res.headers.get('location')
  if (!uploadUrl) throw new Error('Drive returned no Location header')
  return uploadUrl
}

// How many files each mission folder holds. One Drive query for all missions:
// the folder list is only ~27 entries, so a single OR'd parents filter fits.
let countsCache: { at: number; counts: Record<string, number> } | null = null

export async function getMissionCounts(): Promise<Record<string, number>> {
  if (countsCache && Date.now() - countsCache.at < 15_000) return countsCache.counts

  const d = drive()
  const listed = await d.files.list({
    q: `'${MISSION_ROOT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  const byFolderName = new Map<string, string>()
  for (const f of listed.data.files ?? []) {
    if (f.id && f.name) {
      byFolderName.set(f.name, f.id)
      folderIds[f.name] = f.id
    }
  }

  const counts: Record<string, number> = {}
  const idToMission = new Map<string, string>()
  const clauses: string[] = []
  for (const m of MISSIONS) {
    counts[m.id] = 0
    const fid = byFolderName.get(m.folder)
    if (!fid) continue
    idToMission.set(fid, m.id)
    clauses.push(`'${fid}' in parents`)
  }

  if (clauses.length) {
    let pageToken: string | undefined
    do {
      const files = await d.files.list({
        q: `(${clauses.join(' or ')}) and trashed=false`,
        fields: 'nextPageToken, files(parents)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      for (const f of files.data.files ?? []) {
        for (const p of f.parents ?? []) {
          const mid = idToMission.get(p)
          if (mid) counts[mid] += 1
        }
      }
      pageToken = files.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  countsCache = { at: Date.now(), counts }
  return counts
}

export function invalidateMissionCounts() {
  countsCache = null
}
