# 承氣 WebAR 設計平台

承氣是一個影像觸發式 WebAR 多圖層平台原型。使用者可以建立 AR 專案、上傳 Trigger Image、新增圖片/影片圖層、調整 3D 空間、設定透明去背，並用手機 Viewer 掃描圖片顯示 AR 效果。

Production site:

```text
https://chengqi-ar-design-platform.netlify.app
```

## 核心功能

- 作品庫：不需登入即可進入，方便 demo 與小組快速測試。
- 公開 Viewer：`/viewer/:projectId` 和 `/target/:projectId` 可直接開啟，手機可直接掃描。
- 作品庫：資料夾分類、作品卡、建立/刪除/下載 project JSON。
- 3D Editor：Three.js + TransformControls 編輯 position、rotation、scale、Z 深度。
- 多圖層：支援圖片/影片、多檔上傳、排序、顯示/隱藏、重新命名。
- Trigger Image：上傳後產生 MindAR `.mind` target。
- 背景透明化：每層支援 chroma key 顏色、threshold、softness。
- 手機 AR：MindAR image tracking 掃描 Trigger Image 後顯示平台設定的圖層效果。
- 穩定化：Viewer 會對 AR anchor 做平滑處理，降低手機掃描時的抖動。
- 錄影：手機端可錄製相機背景與 AR 圖層合成畫面。

## 技術

- Vite + React + TypeScript
- Three.js
- MindAR image tracking
- Supabase Database / Storage
- Netlify Functions
- Express local API fallback

## 路由

```text
/                         作品庫
/editor/:projectId        AR 編輯器
/viewer/:projectId        手機 AR Viewer，公開
/target/:projectId        乾淨 Trigger Image，公開
/ar-test/:projectId       專案 AR 測試頁，公開
/mindar-smoke-test        MindAR runtime 測試頁，公開
```

## 開發

安裝依賴：

```bash
npm install
```

建立 `.env.local`：

```bash
VITE_DATA_BACKEND=supabase
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_SUPABASE_BUCKET=ar-assets
```

啟動本機開發：

```bash
npm run dev
```

本機網址：

```text
http://localhost:5173
```

手機不能使用電腦上的 `localhost:5173`。手機測試請使用 Netlify HTTPS 網址，或執行：

```bash
npm run tunnel
```

## Supabase 設定

1. 到 SQL Editor 執行 `supabase/schema.sql`。
2. 確認 Storage bucket 是 public：

```text
ar-assets
```

目前 schema 採 demo 模式：

- `anon` 和 `authenticated` 都能讀寫 folders、projects 和 `ar-assets`。
- 這是為了快速 demo；正式上線前應改成登入後台與 authenticated-only 寫入規則。

Service role key 只能放在 Netlify / Supabase 後端環境變數，不能提交到 GitHub。

## Netlify

`netlify.toml` 設定：

- build command：`npm run build`
- publish directory：`dist`
- functions directory：`netlify/functions`
- SPA redirect：支援直接打開 `/editor/:id`、`/viewer/:id`
- no-cache headers：避免手機拿到舊 bundle

目前 site id：

```text
97fd1618-904f-4d8d-bcda-22a92e14477b
```

## 驗證

```bash
npm run build
npm audit --audit-level=moderate
```

## 主要檔案

```text
src/App.tsx                         路由入口
src/components/Gallery.tsx          作品庫首頁
src/components/Editor.tsx           3D 編輯器
src/components/Viewer.tsx           手機 AR Viewer + 錄影
src/ar/projectMindARSession.ts      MindAR 啟動、追蹤與穩定化
src/ar/runtimeLayerMesh.ts          Viewer 圖層 mesh
src/data/projectRepository.ts       資料存取入口
src/data/supabaseProjectRepository.ts Supabase repository
supabase/schema.sql                 DB / RLS / Storage policy
```

## 文件

- [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)
- [AGENTS.md](AGENTS.md)
