# AGENTS.md

這個檔案是給之後協助此專案的 Codex / agent 看的。請先讀完再動手。

## 專案背景

這是一個 Artivive 類型的 WebAR 平台原型，品牌目前叫「承氣」。

核心功能：

- 作品庫首頁 `/`
- AR 編輯器 `/editor/:projectId`
- 手機 Viewer `/viewer/:projectId`
- 乾淨 Trigger Image 頁 `/target/:projectId`
- AR 測試頁 `/ar-test/:projectId`
- MindAR smoke test `/mindar-smoke-test`
- Supabase 儲存 project JSON 和素材
- Netlify 部署 production 網站

主要技術：

- Vite + React + TypeScript
- Three.js
- MindAR image tracking
- Supabase
- Netlify Functions
- Express local API fallback

## 重要安全規則

禁止批量刪除文件或目錄。

不要使用：

- `del /s`
- `rd /s`
- `rmdir /s`
- `Remove-Item -Recurse`
- `rm -rf`

如果需要刪除文件，只能一次刪除一個明確路徑的文件。

正確示範：

```powershell
Remove-Item "C:\path\to\file.txt"
```

如果需要批量刪除文件，應停止操作，並請使用者手動刪除。

## 工作方式

- 優先讀現有程式，不要猜架構。
- 搜尋請優先使用 `rg` 或 `rg --files`。
- 手動修改檔案請用 `apply_patch`。
- 不要提交 `.env.local`、service role key、Supabase secret、Netlify token。
- 不要重置或覆蓋使用者未要求的修改。
- 不要更改無關檔案。
- 不要安裝新套件，除非功能確實需要；安裝後要跑 `npm audit --audit-level=moderate`。

## 常用指令

```powershell
npm run dev
npm run build
npm audit --audit-level=moderate
npm run tunnel
```

`npm run build` 會跑：

```text
tsc --noEmit && vite build
```

如果在沙盒內遇到 `spawn EPERM`，通常是 Vite/esbuild 需要啟動子程序，應用正常的 escalated command 流程重跑。

## 主要檔案

- `src/App.tsx`：路由入口。
- `src/components/Gallery.tsx`：作品庫。
- `src/components/Editor.tsx`：3D AR 編輯器。
- `src/components/Viewer.tsx`：手機掃描 Viewer 和錄影功能。
- `src/components/TargetImagePage.tsx`：乾淨 Trigger Image 頁。
- `src/components/ARTest.tsx`：用專案圖層測 AR。
- `src/components/MindARSmokeTest.tsx`：MindAR runtime 測試。
- `src/types/project.ts`：Project / Layer 型別。
- `src/data/projectRepository.ts`：資料存取入口。
- `src/data/supabaseProjectRepository.ts`：Supabase 實作。
- `src/data/hydrateRuntimeProject.ts`：把 asset id 轉成 runtime URL。
- `src/three/chromaKeyMaterial.ts`：Editor 透明去背 shader。
- `src/three/layerMesh.ts`：Editor 圖層 mesh。
- `src/ar/runtimeLayerMesh.ts`：Viewer 圖層 mesh。
- `src/ar/projectMindARSession.ts`：MindAR 啟動和追蹤 session。
- `src/ar/mindRuntime.ts`：MindAR runtime 載入。
- `src/ar/mindCompiler.ts`：`.mind` 產生邏輯。
- `netlify/functions/compile-mind-target.ts`：Netlify Function。
- `server/index.ts`：本機 API fallback。
- `docs/HOW_IT_WORKS.md`：系統運作說明。

## AR / 手機測試注意事項

- 手機相機需要 HTTPS。
- 手機不能打 `localhost:5173` 測電腦上的服務。
- 本機 demo 可用 `npm run tunnel`。
- 正式 demo 優先用 Netlify URL。
- Viewer 必須有目前版本的 `.mind` 才能掃描。
- 掃描時要掃 `/target/:projectId` 的乾淨 Trigger Image，不要掃 Editor 畫布截圖。

## 錄影功能注意事項

Viewer 的紅色錄影按鈕使用：

- `canvas.captureStream()`
- `MediaRecorder`
- Web Share API fallback

錄影是把相機 video 和 MindAR WebGL canvas 合成到隱藏 canvas 後錄製。

限制：

- Android Chrome 通常最穩。
- iOS Safari 視版本支援度不同。
- 若素材跨網域沒有 CORS，錄影 canvas 可能被瀏覽器阻擋。

## 部署

目前 production site：

```text
https://bang287-ar-app.netlify.app
```

部署前建議：

```powershell
npm run build
npm audit --audit-level=moderate
git status --short
```

如果要部署到 Netlify，請使用已連結的 Netlify site，不要建立新 site，除非使用者明確要求。

目前 site id：

```text
97fd1618-904f-4d8d-bcda-22a92e14477b
```

## 文件維護

如果改了核心流程，請同步更新：

- `docs/HOW_IT_WORKS.md`
- 本檔案 `AGENTS.md`

尤其是：

- 新路由
- 新資料欄位
- Supabase schema 改動
- AR 掃描流程
- 錄影流程
- 部署流程
