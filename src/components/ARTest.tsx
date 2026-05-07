import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Clipboard, Layers, RefreshCw } from "lucide-react";
import { buildInfo } from "../buildInfo";
import { startProjectMindARSession, type ProjectARDiagnostics } from "../ar/projectMindARSession";
import { projectRepository } from "../data/projectRepository";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";
import type { ARProject } from "../types/project";

type TestMode = "loading" | "idle" | "starting" | "tracking" | "lost" | "error" | "missing-mind";
type RuntimeDiagnostics = {
  camera: string;
  runtime: string;
  mindarStart: string;
  mindTarget: string;
  layers: string;
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

export const ARTest = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [mode, setMode] = useState<TestMode>("loading");
  const [status, setStatus] = useState("載入專案 AR 測試");
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>({
    camera: "not tested",
    runtime: "not loaded",
    mindarStart: "not started",
    mindTarget: "not loaded",
    layers: "not loaded",
  });
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
    setStatus("正在從 Supabase 讀取專案");
    patchDiagnostics({ mindarStart: "not started", mindTarget: "not loaded", layers: "not loaded" });

    try {
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setLoadedAt(new Date().toLocaleString("zh-Hant", { hour12: false }));
      if (hydrated.mindTargetUrl) {
        setMode("idle");
        setStatus("已讀到 .mind，請點 Start Project AR");
      } else {
        setMode("missing-mind");
        setStatus("這個專案沒有 .mind，無法測試圖片追蹤");
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
      ["layers", diagnostics.layers],
      ["mindarStart", diagnostics.mindarStart],
      ["browser", navigator.userAgent],
    ],
    [
      diagnostics.camera,
      diagnostics.layers,
      diagnostics.mindTarget,
      diagnostics.mindarStart,
      diagnostics.runtime,
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
            <button className="secondary" onClick={loadProject}>
              <RefreshCw size={20} />
              Reload
            </button>
            <button className="secondary" onClick={copyDebug}>
              <Clipboard size={19} />
              {copied ? "Copied" : "Copy Debug"}
            </button>
            <p>這頁會載入同一個 .mind，掃到 Trigger Image 後顯示 Editor 內設定的實際圖片與影片圖層。</p>
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
