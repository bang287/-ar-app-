import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Bug, Camera, Clipboard, ExternalLink, Home, Layers, Play, RefreshCw, Smartphone, Video } from "lucide-react";
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
  depthMode: string;
};
type RecordingState = "idle" | "starting" | "recording" | "saving" | "ready" | "error";
type RecordingController = {
  canvas: HTMLCanvasElement;
  chunks: BlobPart[];
  extension: "mp4" | "webm";
  frameId: number;
  mimeType: string;
  recorder: MediaRecorder;
  startedAt: number;
  stream: MediaStream;
};
type NavigatorWithFileShare = Navigator & {
  canShare?: (data: ShareData & { files?: File[] }) => boolean;
  share?: (data: ShareData & { files?: File[] }) => Promise<void>;
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

const formatRecordingTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
};

const selectRecordingType = () => {
  const candidates = [
    { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" as const },
    { mimeType: "video/mp4", extension: "mp4" as const },
    { mimeType: "video/webm;codecs=vp9", extension: "webm" as const },
    { mimeType: "video/webm;codecs=vp8", extension: "webm" as const },
    { mimeType: "video/webm", extension: "webm" as const },
  ];
  const supported = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType));
  return supported ?? { mimeType: "", extension: "webm" as const };
};

const drawCover = (
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) => {
  if (!sourceWidth || !sourceHeight || !canvasWidth || !canvasHeight) return;
  const scale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(source, (canvasWidth - width) / 2, (canvasHeight - height) / 2, width, height);
};

const drawRoundedRect = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
};

const drawRecordHud = (context: CanvasRenderingContext2D, width: number, height: number, seconds: number) => {
  const label = `REC ${formatRecordingTime(seconds)}`;
  context.save();
  context.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const textWidth = context.measureText(label).width;
  const pillWidth = textWidth + 62;
  const pillHeight = 46;
  const x = 24;
  const y = 24;
  context.fillStyle = "rgba(10, 13, 18, 0.68)";
  drawRoundedRect(context, x, y, pillWidth, pillHeight, 22);
  context.fill();
  context.fillStyle = "#ef2a1f";
  context.beginPath();
  context.arc(x + 24, y + pillHeight / 2, 8, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.fillText(label, x + 42, y + 31);
  context.restore();

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 4;
  context.strokeRect(10, 10, Math.max(0, width - 20), Math.max(0, height - 20));
  context.restore();
};

const findCameraVideo = (stage: HTMLElement) =>
  Array.from(stage.querySelectorAll("video")).find((video) => video.videoWidth > 0 && video.videoHeight > 0 && video.srcObject instanceof MediaStream) ??
  Array.from(stage.querySelectorAll("video")).find((video) => video.videoWidth > 0 && video.videoHeight > 0) ??
  null;

const findArCanvas = (stage: HTMLElement, compositeCanvas: HTMLCanvasElement) =>
  Array.from(stage.querySelectorAll("canvas")).find((canvas) => canvas !== compositeCanvas && canvas.width > 0 && canvas.height > 0) ?? null;

const makeRecordingFileName = (projectName?: string, extension: "mp4" | "webm" = "webm") => {
  const safeName = (projectName || "chengqi-ar")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 42);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeName || "chengqi-ar"}-${stamp}.${extension}`;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

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
  depthMode: "not set",
};

export const Viewer = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const recordingRef = useRef<RecordingController | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [status, setStatus] = useState("載入 AR 專案");
  const [mode, setMode] = useState<ViewerMode>("loading");
  const [mindUrlCheck, setMindUrlCheck] = useState<MindUrlCheck>({ status: "unchecked", detail: "not checked" });
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>(emptyDiagnostics);
  const [loadedAt, setLoadedAt] = useState("");
  const [copiedDebug, setCopiedDebug] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const hasMindTarget = Boolean(project?.mindTargetUrl);
  const targetUrl = project ? `${window.location.origin}/target/${project.id}` : "";
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const liveMode = mode === "starting" || mode === "tracking" || mode === "lost" || mode === "camera-test";
  const canRecord = mode === "tracking" || mode === "lost" || mode === "camera-test";
  const isRecording = recordingState === "recording" || recordingState === "starting";

  const patchDiagnostics = useCallback((patch: ProjectARDiagnostics) => {
    setDiagnostics((current) => ({ ...current, ...patch }));
  }, []);

  const discardRecording = useCallback(() => {
    const controller = recordingRef.current;
    if (!controller) return;

    window.cancelAnimationFrame(controller.frameId);
    controller.recorder.ondataavailable = null;
    controller.recorder.onerror = null;
    controller.recorder.onstop = null;
    if (controller.recorder.state !== "inactive") {
      try {
        controller.recorder.stop();
      } catch {
        // The recorder may already be stopping.
      }
    }
    controller.stream.getTracks().forEach((track) => track.stop());
    recordingRef.current = null;
    setRecordingState("idle");
    setRecordingError(null);
    setRecordingSeconds(0);
  }, []);

  const clearStage = useCallback(() => {
    discardRecording();
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current?.querySelectorAll("canvas, video").forEach((node) => node.remove());
  }, [discardRecording]);

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
    setShowDebug(false);
    setRecordingError(null);
    setRecordingSeconds(0);
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
        setStatus(`舊版 .mind 不是 ${MIND_AR_COMPILER_VERSION}，請回 Editor 重新產生`);
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
      discardRecording();
    };
  }, [discardRecording]);

  useEffect(() => {
    if (recordingState !== "recording") return;
    const timer = window.setInterval(() => setRecordingSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recordingState]);

  useEffect(() => {
    if (liveMode) return;
    discardRecording();
  }, [discardRecording, liveMode]);

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
      setStatus("這個專案還沒有 .mind，請回 Editor 重新產生");
      return;
    }

    try {
      setShowDebug(false);
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

  const finalizeRecording = useCallback(
    async (controller: RecordingController) => {
      window.cancelAnimationFrame(controller.frameId);
      controller.stream.getTracks().forEach((track) => track.stop());
      if (recordingRef.current === controller) recordingRef.current = null;

      const type = controller.mimeType || (controller.extension === "mp4" ? "video/mp4" : "video/webm");
      const blob = new Blob(controller.chunks, { type });
      if (!blob.size) {
        setRecordingState("error");
        setRecordingError("錄影失敗：沒有產生影片資料");
        setStatus("錄影失敗，請再試一次");
        return;
      }

      const fileName = makeRecordingFileName(project?.name, controller.extension);
      const file = new File([blob], fileName, { type: blob.type || type });
      const shareNavigator = navigator as NavigatorWithFileShare;

      try {
        if (shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
          await shareNavigator.share({ files: [file], title: `${project?.name ?? "承氣 AR"} 錄影` });
          setStatus("影片已產生，可在手機分享面板儲存");
        } else {
          downloadBlob(blob, fileName);
          setStatus("影片已產生，已開始下載");
        }
        setRecordingState("ready");
        setRecordingError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus("影片已產生，分享已取消");
          setRecordingState("ready");
          return;
        }
        console.warn("Share failed, falling back to download", error);
        downloadBlob(blob, fileName);
        setStatus("分享失敗，已改用下載");
        setRecordingState("ready");
      }
    },
    [project?.name],
  );

  const renderRecordingFrame = useCallback(
    (controller: RecordingController) => {
      const stage = containerRef.current;
      const context = controller.canvas.getContext("2d", { alpha: false });
      if (!stage || !context) return;

      try {
        const rect = stage.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(320, Math.round(rect.width * pixelRatio));
        const height = Math.max(320, Math.round(rect.height * pixelRatio));
        if (controller.canvas.width !== width || controller.canvas.height !== height) {
          controller.canvas.width = width;
          controller.canvas.height = height;
        }

        context.fillStyle = "#05070b";
        context.fillRect(0, 0, width, height);

        const cameraVideo = findCameraVideo(stage);
        if (cameraVideo) {
          drawCover(context, cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight, width, height);
        }

        const arCanvas = findArCanvas(stage, controller.canvas);
        if (arCanvas) {
          drawCover(context, arCanvas, arCanvas.width, arCanvas.height, width, height);
        }

        drawRecordHud(context, width, height, (Date.now() - controller.startedAt) / 1000);
        controller.frameId = window.requestAnimationFrame(() => renderRecordingFrame(controller));
      } catch (error) {
        console.error(error);
        discardRecording();
        setRecordingState("error");
        setRecordingError("錄影合成失敗，可能是跨網域素材限制");
        setStatus("錄影失敗，但 AR 播放不受影響");
      }
    },
    [discardRecording],
  );

  const startRecording = useCallback(async () => {
    const stage = containerRef.current;
    if (!stage || recordingRef.current || recordingState === "starting" || recordingState === "saving") return;
    setRecordingState("starting");
    setRecordingError(null);
    setRecordingSeconds(0);

    try {
      if (!("MediaRecorder" in window)) throw new Error("此瀏覽器不支援 MediaRecorder 錄影");

      const cameraVideo = findCameraVideo(stage);
      if (!cameraVideo) throw new Error("尚未找到相機畫面，請等相機啟動後再錄影");

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("無法建立錄影合成畫布");

      const captureStream = canvas.captureStream?.bind(canvas);
      if (!captureStream) throw new Error("此瀏覽器不支援 canvas 錄影，請改用 Android Chrome 或新版 iOS Safari");

      const selected = selectRecordingType();
      const stream = captureStream(30);
      const recorder = new MediaRecorder(stream, selected.mimeType ? { mimeType: selected.mimeType } : undefined);
      const controller: RecordingController = {
        canvas,
        chunks: [],
        extension: selected.extension,
        frameId: 0,
        mimeType: selected.mimeType,
        recorder,
        startedAt: Date.now(),
        stream,
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) controller.chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        const message = (event as Event & { error?: Error }).error?.message ?? "錄影器發生錯誤";
        setRecordingError(message);
        setRecordingState("error");
        setStatus(message);
      };
      recorder.onstop = () => {
        void finalizeRecording(controller);
      };

      recordingRef.current = controller;
      renderRecordingFrame(controller);
      recorder.start(1000);
      setRecordingState("recording");
      setStatus("錄影中，再按一次紅色按鈕停止");
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "錄影啟動失敗";
      setRecordingState("error");
      setRecordingError(message);
      setStatus(message);
    }
  }, [finalizeRecording, recordingState, renderRecordingFrame]);

  const stopRecording = useCallback(() => {
    const controller = recordingRef.current;
    if (!controller) {
      setRecordingState("idle");
      return;
    }

    setRecordingState("saving");
    setStatus("正在產生錄影影片");
    if (controller.recorder.state === "inactive") {
      void finalizeRecording(controller);
      return;
    }
    controller.recorder.stop();
  }, [finalizeRecording]);

  const toggleRecording = () => {
    if (recordingState === "recording") {
      stopRecording();
      return;
    }
    if (recordingState === "starting" || recordingState === "saving") return;
    void startRecording();
  };

  const canStartAR = Boolean(project && mode === "idle" && hasMindTarget);
  const canWaitForMind = Boolean(project && mode === "waiting-mind");
  const canRetry = Boolean(project && mode === "error" && hasMindTarget);
  const modeIcon = mode === "tracking" ? <Play size={18} /> : <Camera size={18} />;
  const recordingBadge =
    recordingState === "recording"
      ? `REC ${formatRecordingTime(recordingSeconds)}`
      : recordingState === "starting"
        ? "準備錄影"
        : recordingState === "saving"
          ? "正在產生影片"
          : recordingState === "ready"
            ? "影片已產生"
            : recordingState === "error"
              ? "錄影失敗"
              : "";
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
      ["depthMode", diagnostics.depthMode],
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
      diagnostics.depthMode,
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
          <a href="/" title="回首頁">
            <Home size={18} />
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
            <p>掃描時請用 /target 頁面的乾淨圖片，不要掃 Editor 畫布或有圖層覆蓋的截圖。</p>
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
            <p>Viewer 需要目前版本的 .mind 才能掃描。請回 Editor 重新產生，完成後再重新載入。</p>
          </div>
        )}

        {isLocalhost && (
          <div className="viewer-warning">
            <AlertTriangle size={16} />
            <span>手機不能使用 localhost，請開 Netlify HTTPS URL。</span>
          </div>
        )}

        {liveMode && (
          <div className="recording-ui">
            {recordingBadge && (
              <div className={`recording-badge ${recordingState}`}>
                <span />
                {recordingBadge}
              </div>
            )}
            {recordingError && <small className="recording-error">{recordingError}</small>}
            <button
              className={`record-button ${isRecording ? "recording" : ""}`}
              disabled={!canRecord || recordingState === "starting" || recordingState === "saving"}
              onClick={toggleRecording}
              title={isRecording ? "停止錄影" : canRecord ? "開始錄影" : "相機啟動後才能錄影"}
            >
              <span className="record-button-ring">
                <span />
              </span>
            </button>
          </div>
        )}

        <button className={`viewer-debug-toggle ${showDebug ? "open" : ""}`} onClick={() => setShowDebug((current) => !current)}>
          <Bug size={14} />
          Debug
        </button>

        {showDebug && (
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
        )}

        <div className={`viewer-bottom ${liveMode ? "live" : ""}`}>
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
