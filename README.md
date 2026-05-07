# 承氣 WebAR Editor

承氣是一個 Artivive 類型的 WebAR 原型平台。使用者可以建立自己的 AR 專案，上傳 Trigger Image，新增多個圖片/影片圖層，在 3D 編輯器裡調整位置、旋轉、縮放、深度、透明度與色鍵去背，最後用手機瀏覽器掃描圖片顯示 AR 效果。

Production site:

```text
https://bang287-ar-app.netlify.app
```

更完整的架構與程式說明請看：

- [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)
- [AGENTS.md](AGENTS.md)

## 功能

- 作品庫首頁：類 Artivive 工作區，可建立資料夾和 AR 作品。
- 多圖層 Editor：支援圖片/影片圖層、多檔上傳、排序、顯示/隱藏、刪除和重新命名。
- 3D Transform 編輯：使用 Three.js + TransformControls 調整 position、rotation、scale 和 Z 深度。
- Trigger Image：上傳觸發圖片並產生 MindAR `.mind` target。
- 背景透明化：每個圖層可設定 chroma key 顏色、threshold、softness。
- 時間軸：每個圖層支援 start time、end time 和 loop。
- 手機 Viewer：使用 MindAR image tracking 開相機掃描 Trigger Image。
- 側面圖層深度：Viewer 會加強圖層 Z 深度，手機斜看時能看出前後層次。
- 真錄影：手機端可錄製相機畫面加 AR 圖層，並分享或下載影片。
- Supabase 後端：保存 project JSON 與素材，並保留本機 API fallback。
- Netlify 部署：支援 SPA route 和 Netlify Functions。

## 技術棧

- Vite
- React
- TypeScript
- Three.js
- MindAR
- Supabase
- Netlify Functions
- Express local API fallback

## 主要路由

```text
/                         作品庫首頁
/editor/:projectId        AR 專案編輯器
/viewer/:projectId        手機 AR 掃描 Viewer
/target/:projectId        乾淨 Trigger Image 頁
/ar-test/:projectId       專案 AR 測試頁
/mindar-smoke-test        MindAR runtime 測試頁
```

## 快速開始

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

前端預設在：

```text
http://localhost:5173
```

## 手機 Demo

手機不能直接打電腦的 `localhost:5173`，因為手機的 localhost 是手機自己。

建議方式：

1. 使用 Netlify production URL。
2. 或本機使用 HTTPS tunnel：

```bash
npm run tunnel
```

手機測試流程：

1. 在桌機開 `/editor/:projectId`。
2. 上傳 Trigger Image。
3. 等 Editor 顯示 `.mind ready`。
4. 新增圖片/影片圖層並調整 3D 位置。
5. 手機開 `/viewer/:projectId`。
6. 點 `Start AR`。
7. 用另一個螢幕或列印紙開 `/target/:projectId` 的乾淨 Trigger Image。
8. 掃描後顯示多圖層 AR 效果。

## 錄影

Viewer 的紅色錄影按鈕會錄製：

- 手機相機背景。
- MindAR WebGL AR 圖層。
- REC HUD。

停止錄影後會優先使用手機 Web Share API 分享/儲存影片；不支援時會自動下載影片檔。

限制：

- Android Chrome 通常最穩。
- iOS Safari 支援度和 iOS 版本有關。
- 若跨網域素材沒有正確 CORS，瀏覽器可能禁止錄影合成，但 AR 播放仍可繼續。

## Build

```bash
npm run build
```

安全檢查：

```bash
npm audit --audit-level=moderate
```

## Netlify

`netlify.toml` 已設定：

- build command：`npm run build`
- publish directory：`dist`
- functions directory：`netlify/functions`
- SPA redirect：所有路由導回 `index.html`
- Viewer / Editor / Target 頁的 no-cache header

目前 Netlify site id：

```text
97fd1618-904f-4d8d-bcda-22a92e14477b
```

## Supabase

需要設定：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_BUCKET`

Storage bucket 預設：

```text
ar-assets
```

如果使用 Netlify Function 或後端編譯 `.mind`，service role key 只能放在 Netlify/Supabase 的環境變數，不能提交到 GitHub。

## 專案結構

```text
src/
  App.tsx                         route switch
  components/
    Gallery.tsx                   作品庫首頁
    Editor.tsx                    3D 編輯器
    Viewer.tsx                    手機 AR Viewer + 錄影
    TargetImagePage.tsx           乾淨 Trigger Image
    ARTest.tsx                    專案 AR 測試頁
    MindARSmokeTest.tsx           MindAR runtime 測試
  ar/
    projectMindARSession.ts       MindAR 啟動與追蹤流程
    runtimeLayerMesh.ts           Viewer 圖層 mesh
    mindRuntime.ts                MindAR runtime 載入
    mindCompiler.ts               .mind compiler fallback
  data/
    projectRepository.ts          資料存取入口
    supabaseProjectRepository.ts  Supabase repository
    hydrateRuntimeProject.ts      asset id 轉 runtime URL
  three/
    layerMesh.ts                  Editor 圖層 mesh
    chromaKeyMaterial.ts          chroma key shader
  types/
    project.ts                    Project / Layer 型別
```

## 後續可加強

- 更穩定的後端 `.mind` compiler。
- 登入與使用者權限。
- 專案版本管理。
- 3D model / audio / text layer。
- 色鍵吸管工具。
- 錄影倒數、暫停、重錄。
- 更完整的作品發布與分享頁。
