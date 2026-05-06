import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, Layers, Play, Smartphone } from "lucide-react";
import * as THREE from "three";
import type { ARProject } from "../types/project";
import { projectRepository } from "../data/projectRepository";
import { createLayerMesh, type LayerMesh } from "../three/layerMesh";

type MindARThreeInstance = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  addAnchor: (targetIndex: number) => { group: THREE.Group; onTargetFound?: () => void; onTargetLost?: () => void };
  start: () => Promise<void>;
  stop: () => void;
};

type MindARGlobal = {
  IMAGE: {
    MindARThree: new (options: { container: HTMLElement; imageTargetSrc: string }) => MindARThreeInstance;
  };
};

type ViewerMode = "idle" | "starting" | "tracking" | "lost" | "preview" | "error";

const loadMindARScript = () =>
  new Promise<MindARGlobal>((resolve, reject) => {
    const existing = (window as Window & { MINDAR?: MindARGlobal }).MINDAR;
    if (existing?.IMAGE?.MindARThree) {
      resolve(existing);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-mindar-runtime="true"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const mindar = (window as Window & { MINDAR?: MindARGlobal }).MINDAR;
        if (mindar?.IMAGE?.MindARThree) resolve(mindar);
        else reject(new Error("MindAR script loaded without exposing window.MINDAR"));
      });
      existingScript.addEventListener("error", () => reject(new Error("Unable to load MindAR browser script")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";
    script.async = true;
    script.dataset.mindarRuntime = "true";
    script.onload = () => {
      const mindar = (window as Window & { MINDAR?: MindARGlobal }).MINDAR;
      if (mindar?.IMAGE?.MindARThree) resolve(mindar);
      else reject(new Error("MindAR script loaded without exposing window.MINDAR"));
    };
    script.onerror = () => reject(new Error("Unable to load MindAR browser script"));
    document.head.appendChild(script);
  });

const disposeMesh = (mesh: LayerMesh | null) => {
  if (!mesh) return;
  mesh.userData.video?.pause();
  mesh.geometry.dispose();
  mesh.material.dispose();
};

export const Viewer = ({ projectId }: { projectId: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [project, setProject] = useState<ARProject | null>(null);
  const [status, setStatus] = useState("載入 AR 專案");
  const [mode, setMode] = useState<ViewerMode>("idle");
  const [fallbackMode, setFallbackMode] = useState(false);

  const hasMindTarget = Boolean(project?.mindTargetId || project?.mindTargetUrl);
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  useEffect(() => {
    let mounted = true;
    projectRepository
      .getProject(projectId)
      .then(async (stored) => {
        const triggerImageUrl = stored.triggerImageUrl ?? (await projectRepository.createObjectUrl(stored.triggerImageId));
        const mindTargetUrl = stored.mindTargetUrl ?? (await projectRepository.createObjectUrl(stored.mindTargetId));
        const layers = await Promise.all(
          stored.layers.map(async (layer) => ({
            ...layer,
            assetUrl: layer.assetUrl ?? (await projectRepository.createObjectUrl(layer.assetId)),
          })),
        );
        if (!mounted) return;
        setProject({ ...stored, triggerImageUrl, mindTargetUrl, layers });
        setStatus(mindTargetUrl || stored.mindTargetId ? "準備掃描 Trigger Image" : "未附加 .mind，使用 3D 預覽模式");
      })
      .catch((error) => {
        console.error(error);
        if (mounted) {
          setMode("error");
          setStatus(error instanceof Error ? error.message : "專案載入失敗");
        }
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const bootPreviewScene = async () => {
    if (!project || !containerRef.current) return;
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
    setFallbackMode(true);
    setMode("preview");
    setStatus("未附加 .mind，使用 3D 預覽模式");

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
    const trigger = project.triggerImageUrl ? await new THREE.TextureLoader().loadAsync(project.triggerImageUrl) : undefined;
    if (trigger) {
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
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current.querySelectorAll("canvas").forEach((canvas) => canvas.remove());

    if (!project.mindTargetUrl) {
      await bootPreviewScene();
      return;
    }

    try {
      setFallbackMode(false);
      setMode("starting");
      setStatus("啟動相機與圖片辨識");
      const mindar = await loadMindARScript();
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
        if (!mesh) return;
        anchor.group.add(mesh);
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
      setStatus(error instanceof Error ? error.message : "相機啟動失敗，已改用 3D 預覽");
      await bootPreviewScene();
    }
  };

  const startDemo = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (hasMindTarget) await bootMindAR();
    else await bootPreviewScene();
  };

  const canStart = project && mode === "idle";
  const modeIcon = mode === "tracking" || mode === "preview" ? <Play size={18} /> : <Camera size={18} />;

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

        {canStart && (
          <div className="viewer-start-panel">
            <button onClick={startDemo}>
              <Camera size={22} />
              Start AR
            </button>
            <p>{hasMindTarget ? "點擊後會啟動相機，請允許瀏覽器使用鏡頭，再掃描 Trigger Image。" : "這個專案還沒有 .mind，會先用 3D 預覽模式展示圖層效果。"}</p>
          </div>
        )}

        {isLocalhost && (
          <div className="viewer-warning">
            <AlertTriangle size={16} />
            <span>手機不能使用 localhost。請改用 Cloudflare tunnel HTTPS 或 Netlify 網址。</span>
          </div>
        )}

        <div className="viewer-bottom">
          <span>
            <Smartphone size={16} /> iOS / Android
          </span>
          <span>
            <Layers size={16} /> {project?.layers.length ?? 0} layers
          </span>
          {fallbackMode && <span>Preview mode</span>}
        </div>
      </div>
    </main>
  );
};
