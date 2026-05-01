import { google } from 'googleapis'
import { Readable } from 'stream'

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!

function getAuth() {
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
