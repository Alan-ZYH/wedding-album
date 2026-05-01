# 婚禮紀念相簿 - Wedding Album

婚禮現場即時上傳、投放與互動系統。

## 功能

- **賓客端** (`/guest`)：掃 QR Code 上傳照片、影片、送上祝福
- **投放端** (`/display`)：大螢幕幻燈片 + 彈幕祝福
- **管理端** (`/admin`)：審核、管理媒體與祝福、調整設定

---

## 部署教學（Vercel）

### 1. 準備 Firebase

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 建立新專案
3. 啟用 **Firestore Database**（選 production mode）
4. 建立以下索引（Firestore > Indexes > Composite）：
   - Collection: `media`，欄位: `status ASC, approved ASC, uploadTime ASC`
   - Collection: `messages`，欄位: `status ASC, createdAt ASC`
5. 前往 **Project Settings > Service Accounts > Generate new private key**，下載 JSON
6. 前往 **Project Settings > General**，取得 Web App 設定

### 2. 準備 Google Drive API

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案（或使用現有）
3. 啟用 **Google Drive API**
4. 前往 **IAM & Admin > Service Accounts > Create Service Account**
5. 下載 JSON 金鑰
6. **重要**：將 Service Account 的 email 加入目標 Google Drive 資料夾的「共用」（Editor 權限）
   - 資料夾：`https://drive.google.com/drive/folders/1vH-2oFx6IMIzY_kGEwrfcqLOiauMjpD0`
   - 分享給：`your-service-account@your-project.iam.gserviceaccount.com`

### 3. 部署到 Vercel

```bash
# 安裝 Vercel CLI
npm i -g vercel

# 登入
vercel login

# 部署
vercel --prod
```

### 4. 設定環境變數

在 Vercel Dashboard > 專案 > Settings > Environment Variables 加入：

```
ADMIN_PASSWORD          your_strong_password
JWT_SECRET              random_32_char_string

# Firebase Client
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID

# Firebase Admin (from service account JSON)
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY    # 注意：private_key 值，包含 \n

# Google Drive
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
GOOGLE_DRIVE_ROOT_FOLDER_ID   1vH-2oFx6IMIzY_kGEwrfcqLOiauMjpD0
```

> **注意 private_key 格式**：在 Vercel 設定時，直接貼上 JSON 中的 `private_key` 值（含換行符號 `\n`），不需要修改。

### 5. 設定 Vercel 上傳大小限制

在 `vercel.json`（已包含）設定了 350MB 上傳限制，用於支援大型影片。

---

## 本機開發

```bash
# 安裝套件
npm install

# 複製環境變數
cp .env.example .env.local
# 填入實際值...

# 啟動開發伺服器
npm run dev
```

開啟 http://localhost:3000

---

## 頁面路由

| 路徑 | 說明 |
|------|------|
| `/guest` | 賓客上傳頁（給賓客掃 QR Code） |
| `/display` | 投放端（接在大螢幕上） |
| `/admin` | 管理後台（重導向至 dashboard） |
| `/admin/login` | 管理員登入 |
| `/admin/dashboard` | 概覽 |
| `/admin/media` | 媒體管理 |
| `/admin/messages` | 祝福管理 |
| `/admin/settings` | 投放設定 |

---

## 資料夾結構

```
Google Drive
└── 1vH-2oFx6IMIzY_kGEwrfcqLOiauMjpD0/
    └── Wedding Uploads/
        ├── photos/     ← 照片
        ├── videos/     ← 影片
        └── thumbnails/ ← 縮圖（預留）
```

---

## Firestore 索引

首次使用時，如果 Firestore 查詢報錯，請點選錯誤訊息中的連結，自動建立複合索引。

或手動建立：
1. `media`：`status`, `approved`, `uploadTime`
2. `media`：`status`, `guestId`, `uploadTime`
3. `messages`：`status`, `createdAt`
4. `messages`：`status`, `guestId`, `createdAt`

---

## QR Code 產生

將以下網址用任何 QR Code 產生器轉成 QR Code，印出放在婚禮現場：

```
https://your-wedding-app.vercel.app/guest
```

---

## 安全說明

- Google Drive API 金鑰只在後端處理，不暴露前端
- Admin 密碼透過 httpOnly cookie + JWT 驗證
- 檔案上傳前進行 MIME 類型驗證
- 祝福文字進行 XSS sanitize
- 賓客只能操作自己的資料
- Rate limit 防止濫用

---

## 技術架構

- **Framework**: Next.js 14 (App Router)
- **UI**: Tailwind CSS
- **Database**: Firebase Firestore (含 Realtime)
- **Storage**: Google Drive API
- **Auth**: JWT (jose) + httpOnly cookie
- **Deployment**: Vercel
