import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, ExternalLink, Layers, Play, RefreshCw, Smartphone } from "lucide-react";
import * as THREE from "three";
import { buildInfo } from "../buildInfo";
import type { ARProject } from "../types/project";
import { projectRepository } from "../data/projectRepository";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";
import { createLayerMesh, type LayerMesh } from "../three/layerMesh";

type MindARThreeInstance = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  addAnchor: (targetIndex: number) => { group: THREE.Group; onTargetFound?: () => void; onTargetLost?: () => void };
  start: () => Promise<void>;
  stop: () => void;
};

type MindARModule = {
  IMAGE: {
    MindARThree: new (options: { container: HTMLElement; imageTargetSrc: string }) => MindARThreeInstance;
  };
};

type ViewerMode = "idle" | "starting" | "tracking" | "lost" | "waiting-mind" | "preview" | "error" | "loading";
type MindUrlCheck = {
  status: "unchecked" | "checking" | "ok" | "missing" | "error";
  detail: string;
};

const loadMindARModule = () =>
  new Promise<MindARModule>((resolve, reject) => {
    const existing = (window as Window & { MINDAR?: MindARModule }).MINDAR;
    if (existing?.IMAGE?.MindARThree) {
      resolve(existing);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-mindar-runtime="true"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const mindar = (window as Window & { MINDAR?: MindARModule }).MINDAR;
        if (mindar?.IMAGE?.MindARThree) resolve(mindar);
        else reject(new Error("MindAR runtime loaded without MindARThree"));
      });
      existingScript.addEventListener("error", () => reject(new Error("Unable to load MindAR runtime")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";
    script.async = true;
    script.dataset.mindarRuntime = "true";
    script.onload = () => {
      const mindar = (window as Window & { MINDAR?: MindARModule }).MINDAR;
      if (mindar?.IMAGE?.MindARThree) resolve(mindar);
      else reject(new Error("MindAR runtime loaded without MindARThree"));
    };
    script.onerror = () => reject(new Error("Unable to load MindAR runtime"));
    document.head.appendChild(script);
  });

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

export const Viewer = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [status, setStatus] = useState("載入 AR 專案");
  const [mode, setMode] = useState<ViewerMode>("loading");
  const [fallbackMode, setFallbackMode] = useState(false);
  const [mindUrlCheck, setMindUrlCheck] = useState<MindUrlCheck>({ status: "unchecked", detail: "not checked" });
  const [loadedAt, setLoadedAt] = useState<string>("");

  const hasMindTarget = Boolean(project?.mindTargetUrl);
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const clearStage = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current?.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
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
    setFallbackMode(false);
    setMode("loading");
    setStatus("正在從 Supabase 重新讀取專案");
    setMindUrlCheck({ status: "unchecked", detail: "not checked" });
    startedRef.current = false;

    try {
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setLoadedAt(new Date().toLocaleString("zh-Hant", { hour12: false }));
      await checkMindUrl(hydrated.mindTargetUrl);

      if (hydrated.mindTargetUrl) {
        setStatus(".mind ready，點 Start AR 開啟相機");
        setMode("idle");
      } else {
        setStatus("尚未讀到 .mind，請回 Editor 重新保存或上傳 .mind");
        setMode("waiting-mind");
      }
    } catch (error) {
      console.error(error);
      setProject(null);
      setMode("error");
      setStatus(error instanceof Error ? error.message : "專案載入失敗");
      setMindUrlCheck({ status: "error", detail: error instanceof Error ? error.message : "load project failed" });
    }
  }, [checkMindUrl, clearStage, projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const bootPreviewScene = async () => {
    if (!project || !containerRef.current) return;
    clearStage();
    setFallbackMode(true);
    setMode("preview");
    setStatus("3D 預覽模式，這不是相機掃描");

    let stopped = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#10131a");
    const camera = new THREE.PerspectiveCamera(50, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.01, 100);
    camera.position.set(0, 0, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    if (project.triggerImageUrl) {
      const trigger = await new THREE.TextureLoader().loadAsync(project.triggerImageUrl);
      trigger.colorSpace = THREE.SRGBColorSpace;
      group.add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ map: trigger, transparent: true, opacity: 0.35 })));
    }
    const meshes = await Promise.all(project.layers.map((layer) => createLayerMesh(layer).catch(() => null)));
    meshes.forEach((mesh) => {
      if (!mesh) return;
      group.add(mesh);
      if (mesh.userData.video) void mesh.userData.video.play().catch(() => undefined);
    });

    const animate = () => {
      if (stopped) return;
      group.rotation.y = Math.sin(performance.now() / 1800) * 0.12;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    cleanupRef.current = () => {
      stopped = true;
      meshes.forEach(disposeMesh);
      renderer.dispose();
      renderer.domElement.remove();
    };
  };

  const bootMindAR = async () => {
    if (!project || !containerRef.current) return;
    clearStage();

    if (!project.mindTargetUrl) {
      setMode("waiting-mind");
      setStatus("尚未讀到 .mind，不能啟動相機掃描");
      return;
    }

    try {
      setFallbackMode(false);
      setMode("starting");
      setStatus("啟動相機與圖片辨識");
      const mindar = await loadMindARModule();
      const mindarThree = new mindar.IMAGE.MindARThree({
        container: containerRef.current,
        imageTargetSrc: project.mindTargetUrl,
      });
      const { renderer, scene, camera } = mindarThree;
      const anchor = mindarThree.addAnchor(0);
      const meshes = await Promise.all(project.layers.map((layer) => createLayerMesh(layer).catch(() => null)));

      anchor.onTargetFound = () => {
        setMode("tracking");
        setStatus("已辨識目標圖片");
        meshes.forEach((mesh) => {
          if (mesh?.userData.video) void mesh.userData.video.play().catch(() => undefined);
        });
      };
      anchor.onTargetLost = () => {
        setMode("lost");
        setStatus("尋找目標圖片");
        meshes.forEach((mesh) => mesh?.userData.video?.pause());
      };

      meshes.forEach((mesh) => {
        if (mesh) anchor.group.add(mesh);
      });

      await mindarThree.start();
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      cleanupRef.current = () => {
        meshes.forEach(disposeMesh);
        renderer.setAnimationLoop(null);
        mindarThree.stop();
      };
    } catch (error) {
      console.error(error);
      setMode("error");
      setStatus(error instanceof Error ? error.message : "相機啟動失敗");
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
  const canPreview = project && mode === "waiting-mind";
  const modeIcon = mode === "tracking" || mode === "preview" ? <Play size={18} /> : <Camera size={18} />;
  const debugRows = useMemo(
    () => [
      ["origin", window.location.origin],
      ["projectId", projectId],
      ["build", `${buildInfo.version} / ${formatBuildTime(buildInfo.builtAt)}`],
      ["loaded", loadedAt || "not loaded"],
      ["triggerImageId", shortValue(project?.triggerImageId)],
      ["mindTargetId", shortValue(project?.mindTargetId)],
      ["mindTargetUrl", project?.mindTargetUrl ? shortValue(project.mindTargetUrl) : "no"],
      [".mind URL", mindUrlCheck.detail],
    ],
    [loadedAt, mindUrlCheck.detail, project?.mindTargetId, project?.mindTargetUrl, project?.triggerImageId, projectId],
  );

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
            <p>點擊後會啟動相機。請允許瀏覽器使用鏡頭，再掃描 Trigger Image。</p>
          </div>
        )}

        {canPreview && (
          <div className="viewer-start-panel">
            <button onClick={loadProject}>
              <RefreshCw size={22} />
              Reload from Supabase
            </button>
            <a className="viewer-panel-link" href={`/editor/${projectId}`}>
              回 Editor 檢查 .mind
            </a>
            <p>這個 Viewer 目前沒有讀到 .mind。請先回 Editor 重新保存或手動上傳 .mind，再回來重讀。</p>
          </div>
        )}

        {isLocalhost && (
          <div className="viewer-warning">
            <AlertTriangle size={16} />
            <span>手機不能使用 localhost。請改用 Netlify HTTPS 網址。</span>
          </div>
        )}

        <div className="viewer-debug-panel">
          <div className="viewer-debug-heading">
            <strong>Viewer Debug</strong>
            <button onClick={loadProject} title="Reload from Supabase">
              <RefreshCw size={14} />
            </button>
          </div>
          <dl>
            {debugRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={label === ".mind URL" ? mindUrlCheck.status : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          {project?.mindTargetUrl && (
            <a href={project.mindTargetUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              open .mind URL
            </a>
          )}
        </div>

        <div className="viewer-bottom">
          <span>
            <Smartphone size={16} /> iOS / Android
          </span>
          <span>
            <Layers size={16} /> {project?.layers.length ?? 0} layers
          </span>
          <span>build {buildInfo.version}</span>
          {fallbackMode && <span>Preview mode</span>}
        </div>
      </div>
    </main>
  );
};
