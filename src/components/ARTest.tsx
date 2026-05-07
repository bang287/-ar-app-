import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ArrowLeft, Camera, Clipboard, RefreshCw } from "lucide-react";
import { buildInfo } from "../buildInfo";
import { cameraErrorMessage, requestCameraStream, stopMediaStream } from "../ar/camera";
import { loadMindARThree, type MindARThreeInstance, withTimeout } from "../ar/mindRuntime";
import { projectRepository } from "../data/projectRepository";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";
import type { ARProject } from "../types/project";

type TestMode = "loading" | "idle" | "starting" | "tracking" | "lost" | "error" | "missing-mind";

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
  const [status, setStatus] = useState("載入最小 AR 測試");
  const [cameraState, setCameraState] = useState("not tested");
  const [runtimeState, setRuntimeState] = useState("not loaded");
  const [mindarState, setMindarState] = useState("not started");
  const [loadedAt, setLoadedAt] = useState("");
  const [copied, setCopied] = useState(false);

  const clearStage = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current?.querySelectorAll("canvas, video").forEach((node) => node.remove());
  }, []);

  const loadProject = useCallback(async () => {
    clearStage();
    setMode("loading");
    setStatus("正在從 Supabase 讀取專案");
    setMindarState("not started");

    try {
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setLoadedAt(new Date().toLocaleString("zh-Hant", { hour12: false }));
      if (hydrated.mindTargetUrl) {
        setMode("idle");
        setStatus("已讀到 .mind，請點 Start Test");
      } else {
        setMode("missing-mind");
        setStatus("這個專案沒有 .mind，無法測試圖片追蹤");
      }
    } catch (error) {
      console.error(error);
      setMode("error");
      setStatus(error instanceof Error ? error.message : "AR Test 載入失敗");
    }
  }, [clearStage, projectId]);

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

    let mindarThree: MindARThreeInstance | null = null;
    let marker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;

    try {
      setMode("starting");
      setStatus("檢查手機相機權限");
      setCameraState("requesting native getUserMedia");
      setRuntimeState("not loaded");
      setMindarState("not started");

      const stream = await withTimeout(requestCameraStream(), 10000, "Camera permission check timed out after 10 seconds");
      const [track] = stream.getVideoTracks();
      setCameraState(`granted: ${track?.label || "camera stream"}`);
      stopMediaStream(stream);

      setStatus("載入 MindAR 官方 runtime");
      const runtime = await loadMindARThree();
      setRuntimeState(`loaded: ${runtime.source}`);

      setStatus("啟動最小 MindAR 測試場景");
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
      marker = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.55),
        new THREE.MeshBasicMaterial({ color: 0x37bdf8, opacity: 0.85, transparent: true }),
      );
      marker.position.z = 0.04;
      anchor.group.add(marker);

      anchor.onTargetFound = () => {
        setMode("tracking");
        setStatus("AR Test OK：已辨識 Trigger Image");
      };
      anchor.onTargetLost = () => {
        setMode("lost");
        setStatus("相機已啟動，請掃描 Trigger Image");
      };

      cleanupRef.current = () => {
        marker?.geometry.dispose();
        marker?.material.dispose();
        renderer.setAnimationLoop(null);
        try {
          mindarThree?.stop();
        } catch {
          // Stop can throw if MindAR is already half-stopped.
        }
      };

      setMindarState("starting");
      await withTimeout(mindarThree.start(), 18000, "MindAR test start timeout after 18 seconds");
      setMindarState("resolved");
      setMode("lost");
      setStatus("相機已啟動，請掃描 Trigger Image");
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    } catch (error) {
      console.error(error);
      cleanupRef.current?.();
      cleanupRef.current = null;
      const message = error instanceof Error ? error.message : "AR Test 啟動失敗";
      if (message.toLowerCase().includes("camera") || error instanceof DOMException) {
        setCameraState(`failed: ${cameraErrorMessage(error)}`);
      }
      setMindarState(`failed: ${message}`);
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
      ["camera", cameraState],
      ["runtime", runtimeState],
      ["mindarStart", mindarState],
      ["browser", navigator.userAgent],
    ],
    [cameraState, loadedAt, mindarState, project?.mindTargetId, project?.mindTargetUrl, projectId, runtimeState],
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
            <span>{project?.name ?? "AR Test"}</span>
            <strong>{status}</strong>
          </div>
          <Camera size={18} />
        </div>

        {(mode === "idle" || mode === "error" || mode === "missing-mind") && (
          <div className="viewer-start-panel">
            {mode !== "missing-mind" && (
              <button onClick={startTest}>
                <Camera size={22} />
                Start Test
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
            <p>這頁只載入同一個 .mind 和一個藍色平面，用來確認 MindAR 相機追蹤本身是否能啟動。</p>
          </div>
        )}

        <div className={`viewer-debug-panel ${mode === "starting" || mode === "tracking" || mode === "lost" ? "compact" : ""}`}>
          <div className="viewer-debug-heading">
            <strong>AR Test Debug</strong>
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
          <span>build {buildInfo.version}</span>
          <a href={`/viewer/${projectId}`}>Viewer</a>
        </div>
      </div>
    </main>
  );
};
