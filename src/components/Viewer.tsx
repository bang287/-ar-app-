import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, Clipboard, Layers, Play, RefreshCw, Smartphone, Video } from "lucide-react";
import type { ARProject } from "../types/project";
import { buildInfo } from "../buildInfo";
import { cameraErrorMessage, requestCameraStream, stopMediaStream } from "../ar/camera";
import { loadMindARThree, type MindARThreeInstance, withTimeout } from "../ar/mindRuntime";
import { projectRepository } from "../data/projectRepository";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";
import { createLayerMesh, type LayerMesh } from "../three/layerMesh";

type ViewerMode = "idle" | "starting" | "tracking" | "lost" | "waiting-mind" | "error" | "loading" | "camera-test";
type MindUrlCheck = {
  status: "unchecked" | "checking" | "ok" | "missing" | "error";
  detail: string;
};
type RuntimeDiagnostics = {
  camera: string;
  runtime: string;
  mindarStart: string;
};

const disposeMesh = (mesh: LayerMesh | null) => {
  if (!mesh) return;
  mesh.userData.video?.pause();
  mesh.geometry.dispose();
  mesh.material.dispose();
};

const shortValue = (value?: string) => {
  if (!value) return "no";
  if (value.length <= 42) return value;
  return `${value.slice(0, 20)}...${value.slice(-14)}`;
};

const formatBuildTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-Hant", { hour12: false });
};

const isCompactDebugMode = (mode: ViewerMode) => mode === "starting" || mode === "tracking" || mode === "lost" || mode === "camera-test";

export const Viewer = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [status, setStatus] = useState("載入 AR 專案");
  const [mode, setMode] = useState<ViewerMode>("loading");
  const [mindUrlCheck, setMindUrlCheck] = useState<MindUrlCheck>({ status: "unchecked", detail: "not checked" });
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>({
    camera: "not tested",
    runtime: "not loaded",
    mindarStart: "not started",
  });
  const [loadedAt, setLoadedAt] = useState("");
  const [copiedDebug, setCopiedDebug] = useState(false);

  const hasMindTarget = Boolean(project?.mindTargetUrl);
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const patchDiagnostics = useCallback((patch: Partial<RuntimeDiagnostics>) => {
    setDiagnostics((current) => ({ ...current, ...patch }));
  }, []);

  const clearStage = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current?.querySelectorAll("canvas, video").forEach((node) => node.remove());
  }, []);

  const checkMindUrl = useCallback(async (url?: string) => {
    if (!url) {
      setMindUrlCheck({ status: "missing", detail: "no mindTargetUrl" });
      return;
    }

    setMindUrlCheck({ status: "checking", detail: "checking .mind URL" });
    try {
      let response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (response.status === 405) {
        response = await fetch(url, { method: "GET", cache: "no-store", headers: { Range: "bytes=0-16" } });
      }
      const size = response.headers.get("content-length");
      const type = response.headers.get("content-type");
      if (response.ok) {
        setMindUrlCheck({ status: "ok", detail: `${response.status} OK${size ? `, ${size} bytes` : ""}${type ? `, ${type}` : ""}` });
      } else {
        setMindUrlCheck({ status: "error", detail: `${response.status} ${response.statusText}` });
      }
    } catch (error) {
      setMindUrlCheck({ status: "error", detail: error instanceof Error ? error.message : "CORS or network error" });
    }
  }, []);

  const loadProject = useCallback(async () => {
    clearStage();
    setMode("loading");
    setStatus("正在從 Supabase 讀取專案");
    setMindUrlCheck({ status: "unchecked", detail: "not checked" });
    patchDiagnostics({ mindarStart: "not started" });
    startedRef.current = false;

    try {
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setLoadedAt(new Date().toLocaleString("zh-Hant", { hour12: false }));
      await checkMindUrl(hydrated.mindTargetUrl);

      if (hydrated.mindTargetUrl) {
        setStatus(".mind ready，請點 Start AR");
        setMode("idle");
      } else {
        setStatus("尚未附加 .mind，請回 Editor 等到 .mind ready");
        setMode("waiting-mind");
      }
    } catch (error) {
      console.error(error);
      setProject(null);
      setMode("error");
      setStatus(error instanceof Error ? error.message : "Viewer 載入失敗");
      setMindUrlCheck({ status: "error", detail: error instanceof Error ? error.message : "load project failed" });
    }
  }, [checkMindUrl, clearStage, patchDiagnostics, projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const runCameraTest = async () => {
    if (!containerRef.current) return;
    clearStage();
    setMode("camera-test");
    setStatus("Camera Test：正在要求相機權限");
    patchDiagnostics({ camera: "requesting native getUserMedia", mindarStart: "not started" });

    try {
      const stream = await withTimeout(requestCameraStream(), 10000, "Camera Test timeout after 10 seconds");
      const [track] = stream.getVideoTracks();
      patchDiagnostics({ camera: `granted: ${track?.label || "camera stream"}` });

      const video = document.createElement("video");
      video.className = "camera-test-video";
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      containerRef.current.appendChild(video);
      await video.play();
      setStatus("Camera Test OK，可以看到相機畫面");

      cleanupRef.current = () => {
        stopMediaStream(stream);
        video.remove();
      };
    } catch (error) {
      console.error(error);
      const message = cameraErrorMessage(error);
      patchDiagnostics({ camera: `failed: ${message}` });
      setMode("error");
      setStatus(message);
    }
  };

  const bootMindAR = async () => {
    if (!project || !containerRef.current) return;
    clearStage();

    if (!project.mindTargetUrl) {
      setMode("waiting-mind");
      setStatus("這個專案還沒有 .mind，請回 Editor 重新整理或等待產生完成");
      return;
    }

    let mindarThree: MindARThreeInstance | null = null;
    let meshes: LayerMesh[] = [];
    try {
      setMode("starting");
      setStatus("檢查手機相機權限");
      patchDiagnostics({ camera: "requesting native getUserMedia", runtime: "not loaded", mindarStart: "not started" });

      const stream = await withTimeout(requestCameraStream(), 10000, "Camera permission check timed out after 10 seconds");
      const [track] = stream.getVideoTracks();
      patchDiagnostics({ camera: `granted: ${track?.label || "camera stream"}` });
      stopMediaStream(stream);

      setStatus("載入 MindAR 官方 Three.js runtime");
      const runtime = await loadMindARThree();
      patchDiagnostics({ runtime: `loaded: ${runtime.source}` });

      setStatus("建立 MindAR 圖片追蹤場景");
      mindarThree = new runtime.MindARThree({
        container: containerRef.current,
        imageTargetSrc: project.mindTargetUrl,
        maxTrack: 1,
        uiLoading: "yes",
        uiScanning: "yes",
        uiError: "yes",
      });
      const { renderer, scene, camera } = mindarThree;
      const anchor = mindarThree.addAnchor(0);

      anchor.onTargetFound = () => {
        setMode("tracking");
        setStatus("已辨識 Trigger Image，正在顯示 AR 圖層");
        meshes.forEach((mesh) => {
          if (mesh.userData.video) void mesh.userData.video.play().catch(() => undefined);
        });
      };
      anchor.onTargetLost = () => {
        setMode("lost");
        setStatus("追蹤暫停，請重新對準 Trigger Image");
        meshes.forEach((mesh) => mesh.userData.video?.pause());
      };

      cleanupRef.current = () => {
        meshes.forEach(disposeMesh);
        renderer.setAnimationLoop(null);
        try {
          mindarThree?.stop();
        } catch {
          // MindAR can throw if stop is called before start fully resolves.
        }
      };

      setStatus("啟動相機與圖片辨識");
      patchDiagnostics({ mindarStart: "starting" });
      await withTimeout(mindarThree.start(), 18000, "MindAR start timeout after 18 seconds. Try Chrome/Safari, close other camera apps, then retry.");
      patchDiagnostics({ mindarStart: "resolved" });
      setMode("lost");
      setStatus("相機已啟動，請掃描 Trigger Image");
      renderer.setAnimationLoop(() => renderer.render(scene, camera));

      const loadedMeshes = await Promise.all(project.layers.map((layer) => createLayerMesh(layer).catch(() => null)));
      meshes = loadedMeshes.filter((mesh): mesh is LayerMesh => Boolean(mesh));
      meshes.forEach((mesh) => anchor.group.add(mesh));
      setStatus("AR 圖層已載入，請對準 Trigger Image");
    } catch (error) {
      console.error(error);
      cleanupRef.current?.();
      cleanupRef.current = null;
      const message = error instanceof Error ? error.message : "相機或 MindAR 啟動失敗";
      if (message.toLowerCase().includes("camera")) patchDiagnostics({ camera: `failed: ${message}` });
      patchDiagnostics({ mindarStart: `failed: ${message}` });
      setMode("error");
      setStatus(message);
    }
  };

  const startDemo = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      await bootMindAR();
    } finally {
      startedRef.current = false;
    }
  };

  const canStartAR = project && mode === "idle" && hasMindTarget;
  const canWaitForMind = project && mode === "waiting-mind";
  const canRetry = project && mode === "error" && hasMindTarget;
  const modeIcon = mode === "tracking" ? <Play size={18} /> : <Camera size={18} />;
  const debugRows = useMemo(
    () => [
      ["origin", window.location.origin],
      ["projectId", projectId],
      ["build", `${buildInfo.version} / ${formatBuildTime(buildInfo.builtAt)}`],
      ["loaded", loadedAt || "not loaded"],
      ["browser", navigator.userAgent],
      ["camera", diagnostics.camera],
      ["runtime", diagnostics.runtime],
      ["mindarStart", diagnostics.mindarStart],
      ["triggerImageId", shortValue(project?.triggerImageId)],
      ["mindTargetId", shortValue(project?.mindTargetId)],
      ["mindTargetUrl", project?.mindTargetUrl ? shortValue(project.mindTargetUrl) : "no"],
      [".mind URL", mindUrlCheck.detail],
    ],
    [diagnostics.camera, diagnostics.mindarStart, diagnostics.runtime, loadedAt, mindUrlCheck.detail, project?.mindTargetId, project?.mindTargetUrl, project?.triggerImageId, projectId],
  );
  const debugText = useMemo(() => debugRows.map(([label, value]) => `${label}: ${value}`).join("\n"), [debugRows]);

  const copyDebug = async () => {
    await navigator.clipboard.writeText(debugText);
    setCopiedDebug(true);
    window.setTimeout(() => setCopiedDebug(false), 1200);
  };

  return (
    <main className="viewer-shell">
      <div className="viewer-stage" ref={containerRef}>
        <div className="viewer-hud">
          <a href={`/editor/${projectId}`} title="Back to editor">
            <ArrowLeft size={18} />
          </a>
          <div>
            <span>{project?.name ?? "WebAR Project"}</span>
            <strong>{status}</strong>
          </div>
          {modeIcon}
        </div>

        {canStartAR && (
          <div className="viewer-start-panel">
            <button onClick={startDemo}>
              <Camera size={22} />
              Start AR
            </button>
            <button className="secondary" onClick={runCameraTest}>
              <Video size={20} />
              Camera Test
            </button>
            <button className="secondary" onClick={copyDebug}>
              <Clipboard size={19} />
              {copiedDebug ? "Copied" : "Copy Debug"}
            </button>
            <p>先用 Camera Test 確認手機瀏覽器能開相機，再用 Start AR 啟動 MindAR 圖片追蹤。</p>
          </div>
        )}

        {canRetry && (
          <div className="viewer-start-panel">
            <button onClick={startDemo}>
              <RefreshCw size={22} />
              Retry Start AR
            </button>
            <button className="secondary" onClick={runCameraTest}>
              <Video size={20} />
              Camera Test
            </button>
            <button className="secondary" onClick={copyDebug}>
              <Clipboard size={19} />
              {copiedDebug ? "Copied" : "Copy Debug"}
            </button>
            <p>{status}</p>
          </div>
        )}

        {canWaitForMind && (
          <div className="viewer-start-panel">
            <button onClick={loadProject}>
              <RefreshCw size={22} />
              Reload from Supabase
            </button>
            <a className="viewer-panel-link" href={`/editor/${projectId}`}>
              回 Editor 檢查 .mind
            </a>
            <p>Viewer 需要 .mind 才能做手機掃描。請回 Editor 上傳 Trigger Image，等到右上顯示 .mind ready。</p>
          </div>
        )}

        {isLocalhost && (
          <div className="viewer-warning">
            <AlertTriangle size={16} />
            <span>手機不能使用 localhost，請用 Netlify HTTPS 網址。</span>
          </div>
        )}

        <div className={`viewer-debug-panel ${isCompactDebugMode(mode) ? "compact" : ""}`}>
          <div className="viewer-debug-heading">
            <strong>Viewer Debug</strong>
            <div>
              <button onClick={copyDebug} title="Copy debug">
                <Clipboard size={14} />
              </button>
              <button onClick={loadProject} title="Reload from Supabase">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          <dl>
            {debugRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={label === ".mind URL" ? mindUrlCheck.status : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          <small>.mind 是二進位追蹤檔，手機直接打開出現「無法載入物件」是正常的，不代表 AR 壞掉。</small>
        </div>

        <div className="viewer-bottom">
          <span>
            <Smartphone size={16} /> iOS / Android
          </span>
          <span>
            <Layers size={16} /> {project?.layers.length ?? 0} layers
          </span>
          <span>build {buildInfo.version}</span>
          <a href={`/ar-test/${projectId}`}>AR Test</a>
        </div>
      </div>
    </main>
  );
};
