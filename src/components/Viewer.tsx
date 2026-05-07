import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, Clipboard, ExternalLink, Layers, Play, RefreshCw, Smartphone, Video } from "lucide-react";
import type { ARProject } from "../types/project";
import { buildInfo } from "../buildInfo";
import { cameraErrorMessage, requestCameraStream, stopMediaStream } from "../ar/camera";
import { startProjectMindARSession, type ProjectARDiagnostics } from "../ar/projectMindARSession";
import { hasAnyMindTarget, hasCurrentMindTarget, MIND_AR_COMPILER_VERSION } from "../ar/mindVersion";
import { withTimeout } from "../ar/mindRuntime";
import { projectRepository } from "../data/projectRepository";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";

type ViewerMode = "idle" | "starting" | "tracking" | "lost" | "waiting-mind" | "error" | "loading" | "camera-test";
type MindUrlCheck = {
  status: "unchecked" | "checking" | "ok" | "missing" | "error";
  detail: string;
};
type RuntimeDiagnostics = {
  camera: string;
  runtime: string;
  mindarStart: string;
  mindTarget: string;
  mindCompilerVersion: string;
  layers: string;
  layersLoaded: string;
  imageTargetSrcMode: string;
  targetFoundCount: string;
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

const emptyDiagnostics: RuntimeDiagnostics = {
  camera: "not tested",
  runtime: "not loaded",
  mindarStart: "not started",
  mindTarget: "not loaded",
  mindCompilerVersion: "missing",
  layers: "not loaded",
  layersLoaded: "0",
  imageTargetSrcMode: "not set",
  targetFoundCount: "0",
};

export const Viewer = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [status, setStatus] = useState("載入 AR 專案");
  const [mode, setMode] = useState<ViewerMode>("loading");
  const [mindUrlCheck, setMindUrlCheck] = useState<MindUrlCheck>({ status: "unchecked", detail: "not checked" });
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>(emptyDiagnostics);
  const [loadedAt, setLoadedAt] = useState("");
  const [copiedDebug, setCopiedDebug] = useState(false);

  const hasMindTarget = Boolean(project?.mindTargetUrl);
  const targetUrl = project ? `${window.location.origin}/target/${project.id}` : "";
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const patchDiagnostics = useCallback((patch: ProjectARDiagnostics) => {
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
    setStatus("正在從 Supabase 載入專案");
    setMindUrlCheck({ status: "unchecked", detail: "not checked" });
    setDiagnostics(emptyDiagnostics);
    startedRef.current = false;

    try {
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setLoadedAt(new Date().toLocaleString("zh-Hant", { hour12: false }));
      await checkMindUrl(hydrated.mindTargetUrl);

      patchDiagnostics({ mindCompilerVersion: hydrated.mindCompilerVersion ?? "missing" });
      if (hasCurrentMindTarget(hydrated)) {
        setStatus(".mind ready，請點 Start AR");
        setMode("idle");
      } else if (hasAnyMindTarget(hydrated)) {
        setStatus(`這份 .mind 不是 ${MIND_AR_COMPILER_VERSION} 產生，請回 Editor 重新產生`);
        setMode("waiting-mind");
      } else {
        setStatus("尚未產生 .mind，請回 Editor 等到 .mind ready");
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
    setStatus("Camera Test：正在開啟原生相機");
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
      setStatus("Camera Test OK：可看到手機相機畫面");

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
      setStatus("這個專案沒有 .mind，請回 Editor 重新產生");
      return;
    }

    try {
      setMode("starting");
      const session = await startProjectMindARSession({
        container: containerRef.current,
        project,
        startTimeoutMs: 60000,
        onStatus: setStatus,
        onDiagnostics: patchDiagnostics,
        onTargetFound: () => setMode("tracking"),
        onTargetLost: () => setMode("lost"),
      });
      cleanupRef.current = session.stop;
      setMode("lost");
    } catch (error) {
      console.error(error);
      cleanupRef.current?.();
      cleanupRef.current = null;
      const message = error instanceof Error ? error.message : "啟動 MindAR 失敗";
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
      ["mindTarget", diagnostics.mindTarget],
      ["mindCompilerVersion", diagnostics.mindCompilerVersion],
      ["imageTargetSrcMode", diagnostics.imageTargetSrcMode],
      ["mindarStart", diagnostics.mindarStart],
      ["targetFoundCount", diagnostics.targetFoundCount],
      ["layers", diagnostics.layers],
      ["layersLoaded", diagnostics.layersLoaded],
      ["triggerImageId", shortValue(project?.triggerImageId)],
      ["mindTargetId", shortValue(project?.mindTargetId)],
      ["mindTargetUrl", project?.mindTargetUrl ? shortValue(project.mindTargetUrl) : "no"],
      [".mind URL", mindUrlCheck.detail],
    ],
    [
      diagnostics.camera,
      diagnostics.imageTargetSrcMode,
      diagnostics.layers,
      diagnostics.layersLoaded,
      diagnostics.mindCompilerVersion,
      diagnostics.mindTarget,
      diagnostics.mindarStart,
      diagnostics.runtime,
      diagnostics.targetFoundCount,
      loadedAt,
      mindUrlCheck.detail,
      project?.mindTargetId,
      project?.mindTargetUrl,
      project?.triggerImageId,
      projectId,
    ],
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
            <a className="viewer-panel-link" href={targetUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              開啟乾淨 Trigger 圖
            </a>
            <button className="secondary" onClick={runCameraTest}>
              <Video size={20} />
              Camera Test
            </button>
            <button className="secondary" onClick={copyDebug}>
              <Clipboard size={19} />
              {copiedDebug ? "Copied" : "Copy Debug"}
            </button>
            <p>掃描時請對準「乾淨 Trigger 圖」，不要掃 Editor 畫布或有圖層覆蓋的截圖。</p>
          </div>
        )}

        {canRetry && (
          <div className="viewer-start-panel">
            <button onClick={startDemo}>
              <RefreshCw size={22} />
              Retry Start AR
            </button>
            <a className="viewer-panel-link" href={targetUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              開啟乾淨 Trigger 圖
            </a>
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
              回 Editor 產生 .mind
            </a>
            <p>Viewer 需要目前版本的 .mind 才能掃描。請回 Editor 重新產生後再重新載入。</p>
          </div>
        )}

        {isLocalhost && (
          <div className="viewer-warning">
            <AlertTriangle size={16} />
            <span>手機不能使用 localhost，請用 Netlify HTTPS URL。</span>
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
          <small>如果 targetFoundCount 一直是 0，代表還沒有辨識到 Trigger Image；請用 /target 頁面的乾淨圖片測試。</small>
        </div>

        <div className="viewer-bottom">
          <span>
            <Smartphone size={16} /> iOS / Android
          </span>
          <span>
            <Layers size={16} /> {project?.layers.length ?? 0} layers
          </span>
          {project && <a href={`/target/${project.id}`}>Trigger</a>}
          <span>build {buildInfo.version}</span>
          <a href={`/ar-test/${projectId}`}>AR Test</a>
        </div>
      </div>
    </main>
  );
};
