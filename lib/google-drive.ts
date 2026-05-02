import { google } from 'googleapis'
import { Readable } from 'stream'

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!

export function getAuth() {
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ? process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: getAuth() })
}

const folderCache: Record<string, string> = {}

async function getOrCreateFolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`
  if (folderCache[cacheKey]) return folderCache[cacheKey]

  const drive = getDriveClient()

  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  if (res.data.files && res.data.files.length > 0) {
    const id = res.data.files[0].id!
    folderCache[cacheKey] = id
    return id
  }

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  })

  const id = folder.data.id!
  folderCache[cacheKey] = id
  return id
}

export async function ensureFolders(): Promise<{
  photos: string
  videos: string
  thumbnails: string
}> {
  const weddingFolderId = await getOrCreateFolder('Wedding Uploads', ROOT_FOLDER_ID)
  const [photos, videos, thumbnails] = await Promise.all([
    getOrCreateFolder('photos', weddingFolderId),
    getOrCreateFolder('videos', weddingFolderId),
    getOrCreateFolder('thumbnails', weddingFolderId),
  ])
  return { photos, videos, thumbnails }
}

export interface UploadFileResult {
  fileId: string
  webViewLink: string
  thumbnailLink: string
}

export async function uploadFileToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  isVideo: boolean
): Promise<UploadFileResult> {
  const drive = getDriveClient()
  const folders = await ensureFolders()
  const folderId = isVideo ? folders.videos : folders.photos

  const readable = Readable.from(buffer)

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: 'id,webViewLink,thumbnailLink',
    supportsAllDrives: true,
  })

  const fileId = res.data.id!

  // Make file publicly readable
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true,
  })

  const fileInfo = await drive.files.get({
    fileId,
    fields: 'id,webViewLink,thumbnailLink',
    supportsAllDrives: true,
  })

  return {
    fileId,
    webViewLink: fileInfo.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    thumbnailLink: fileInfo.data.thumbnailLink || '',
  }
}

// Create a resumable upload session on Google Drive.
// Returns the session upload URL (valid ~1 week).
// The client then PUTs the file bytes directly to this URL — bypassing Vercel's 4.5 MB limit.
export async function createResumableUploadSession(
  fileName: string,
  mimeType: string,
  fileSize: number,
  isVideo: boolean
): Promise<string> {
  const auth = getAuth()
  // getAccessToken() returns the raw bearer token string
  const token = await auth.getAccessToken()
  if (!token) throw new Error('Failed to obtain Google access token')

  const folders = await ensureFolders()
  const folderId = isVideo ? folders.videos : folders.photos

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id%2CwebViewLink&supportsAllDrives=true',
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

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Drive resumable session failed: ${res.status} ${text}`)
  }

  const uploadUrl = res.headers.get('location') || res.headers.get('Location')
  if (!uploadUrl) throw new Error('Drive returned no Location header for resumable upload')
  return uploadUrl
}

// After the client has uploaded a file directly to Google Drive,
// call this to make it publicly readable and return its webViewLink.
export async function setDriveFilePublic(
  fileId: string
): Promise<{ webViewLink: string }> {
  const drive = getDriveClient()

  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  })

  const info = await drive.files.get({
    fileId,
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  })

  return {
    webViewLink:
      info.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  }
}

// Search Google Drive for a file by its exact name.
// Returns the file ID if found, or null.
export async function findFileByName(fileName: string): Promise<string | null> {
  const drive = getDriveClient()
  const res = await drive.files.list({
    q: `name='${fileName}' and trashed=false`,
    fields: 'files(id)',
    orderBy: 'createdTime desc',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  return res.data.files?.[0]?.id ?? null
}

export async function deleteFileFromDrive(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.files.delete({
    fileId,
    supportsAllDrives: true,
  })
}

export function buildThumbnailUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`
}

export function buildDirectUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${fileId}`
}
