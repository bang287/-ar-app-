import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Clipboard, ExternalLink, Layers, RefreshCw } from "lucide-react";
import { buildInfo } from "../buildInfo";
import { startProjectMindARSession, type ProjectARDiagnostics } from "../ar/projectMindARSession";
import { hasAnyMindTarget, hasCurrentMindTarget, MIND_AR_COMPILER_VERSION } from "../ar/mindVersion";
import { projectRepository } from "../data/projectRepository";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";
import type { ARProject } from "../types/project";

type TestMode = "loading" | "idle" | "starting" | "tracking" | "lost" | "error" | "missing-mind";
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

const formatBuildTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-Hant", { hour12: false });
};

const shortValue = (value?: string) => {
  if (!value) return "no";
  if (value.length <= 42) return value;
  return `${value.slice(0, 20)}...${value.slice(-14)}`;
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
};

export const ARTest = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [mode, setMode] = useState<TestMode>("loading");
  const [status, setStatus] = useState("載入專案 AR 測試");
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>(emptyDiagnostics);
  const [loadedAt, setLoadedAt] = useState("");
  const [copied, setCopied] = useState(false);

  const patchDiagnostics = useCallback((patch: ProjectARDiagnostics) => {
    setDiagnostics((current) => ({ ...current, ...patch }));
  }, []);

  const clearStage = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current?.querySelectorAll("canvas, video").forEach((node) => node.remove());
  }, []);

  const loadProject = useCallback(async () => {
    clearStage();
    setMode("loading");
    setStatus("正在從 Supabase 載入專案");
    setDiagnostics(emptyDiagnostics);

    try {
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setLoadedAt(new Date().toLocaleString("zh-Hant", { hour12: false }));
      patchDiagnostics({ mindCompilerVersion: hydrated.mindCompilerVersion ?? "missing" });
      if (hasCurrentMindTarget(hydrated)) {
        setMode("idle");
        setStatus(".mind ready，請點 Start Project AR");
      } else if (hasAnyMindTarget(hydrated)) {
        setMode("missing-mind");
        setStatus(`這份 .mind 不是 ${MIND_AR_COMPILER_VERSION} 產生，請回 Editor 重新產生`);
      } else {
        setMode("missing-mind");
        setStatus("這個專案尚未產生 .mind");
      }
    } catch (error) {
      console.error(error);
      setMode("error");
      setStatus(error instanceof Error ? error.message : "AR Test 載入失敗");
    }
  }, [clearStage, patchDiagnostics, projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const startTest = async () => {
    if (!project?.mindTargetUrl || !containerRef.current || startedRef.current) return;
    startedRef.current = true;
    clearStage();

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
      const message = error instanceof Error ? error.message : "AR Test 啟動失敗";
      patchDiagnostics({ mindarStart: `failed: ${message}` });
      setMode("error");
      setStatus(message);
    } finally {
      startedRef.current = false;
    }
  };

  const debugRows = useMemo(
    () => [
      ["origin", window.location.origin],
      ["projectId", projectId],
      ["build", `${buildInfo.version} / ${formatBuildTime(buildInfo.builtAt)}`],
      ["loaded", loadedAt || "not loaded"],
      ["mindTargetId", shortValue(project?.mindTargetId)],
      ["mindTargetUrl", project?.mindTargetUrl ? shortValue(project.mindTargetUrl) : "no"],
      ["camera", diagnostics.camera],
      ["runtime", diagnostics.runtime],
      ["mindTarget", diagnostics.mindTarget],
      ["mindCompilerVersion", diagnostics.mindCompilerVersion],
      ["imageTargetSrcMode", diagnostics.imageTargetSrcMode],
      ["mindarStart", diagnostics.mindarStart],
      ["targetFoundCount", diagnostics.targetFoundCount],
      ["layers", diagnostics.layers],
      ["layersLoaded", diagnostics.layersLoaded],
      ["browser", navigator.userAgent],
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
      project?.mindTargetId,
      project?.mindTargetUrl,
      projectId,
    ],
  );
  const debugText = useMemo(() => debugRows.map(([label, value]) => `${label}: ${value}`).join("\n"), [debugRows]);

  const copyDebug = async () => {
    await navigator.clipboard.writeText(debugText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="viewer-shell">
      <div className="viewer-stage ar-test-stage" ref={containerRef}>
        <div className="viewer-hud">
          <a href={`/viewer/${projectId}`} title="Back to viewer">
            <ArrowLeft size={18} />
          </a>
          <div>
            <span>{project?.name ?? "Project AR Test"}</span>
            <strong>{status}</strong>
          </div>
          <Camera size={18} />
        </div>

        {(mode === "idle" || mode === "error" || mode === "missing-mind") && (
          <div className="viewer-start-panel">
            {mode !== "missing-mind" && (
              <button onClick={startTest}>
                <Camera size={22} />
                Start Project AR
              </button>
            )}
            {project && (
              <a className="viewer-panel-link" href={`/target/${project.id}`} target="_blank" rel="noreferrer">
                <ExternalLink size={18} />
                開啟乾淨 Trigger 圖
              </a>
            )}
            <button className="secondary" onClick={loadProject}>
              <RefreshCw size={20} />
              Reload
            </button>
            <button className="secondary" onClick={copyDebug}>
              <Clipboard size={19} />
              {copied ? "Copied" : "Copy Debug"}
            </button>
            <p>這頁會掃描同一份 .mind，辨識成功後顯示 Editor 設定的專案圖層。</p>
          </div>
        )}

        <div className={`viewer-debug-panel ${mode === "starting" || mode === "tracking" || mode === "lost" ? "compact" : ""}`}>
          <div className="viewer-debug-heading">
            <strong>Project AR Debug</strong>
            <div>
              <button onClick={copyDebug} title="Copy debug">
                <Clipboard size={14} />
              </button>
              <button onClick={loadProject} title="Reload">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          <dl>
            {debugRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="viewer-bottom">
          <span>
            <Layers size={16} /> {project?.layers.length ?? 0} layers
          </span>
          <span>build {buildInfo.version}</span>
          <a href={`/viewer/${projectId}`}>Viewer</a>
        </div>
      </div>
    </main>
  );
};
