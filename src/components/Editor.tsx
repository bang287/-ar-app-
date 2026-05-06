import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Check,
  Copy,
  Eye,
  EyeOff,
  Image,
  Layers,
  MousePointer2,
  Move3D,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { ARLayer, ARProject, LayerKind } from "../types/project";
import { compileMindTarget } from "../ar/mindCompiler";
import { createDefaultProject, createLayer } from "../data/defaultProject";
import { projectRepository } from "../data/projectRepository";
import { applyLayerTransform, createLayerMesh, type LayerMesh } from "../three/layerMesh";
import { updateChromaKeyMaterial } from "../three/chromaKeyMaterial";
import { fileToLayerKind, formatSeconds, setPath } from "../utils/files";

type TransformMode = "translate" | "rotate" | "scale";
type MindStatus = "missing" | "compiling" | "ready" | "failed";

const NumberField = ({
  label,
  value,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) => (
  <label className="field compact-field">
    <span>{label}</span>
    <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
);

const serializableProject = (project: ARProject): ARProject => ({
  ...project,
  triggerImageUrl: undefined,
  mindTargetUrl: undefined,
  layers: project.layers.map((layer) => ({ ...layer, assetUrl: undefined })),
});

const friendlyError = (error: unknown) => (error instanceof Error ? error.message : "未知錯誤");

const mindLabel = (status: MindStatus, progress: number) => {
  if (status === "ready") return ".mind ready";
  if (status === "compiling") return `正在編譯 .mind ${progress}%`;
  if (status === "failed") return ".mind 產生失敗";
  return "尚未產生 .mind";
};

export const Editor = ({ projectId = "local-demo" }: { projectId?: string }) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const triggerMeshRef = useRef<THREE.Mesh | null>(null);
  const layerMeshesRef = useRef<Map<string, LayerMesh>>(new Map());
  const selectedLayerRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [project, setProject] = useState<ARProject>(() => createDefaultProject());
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedDemo, setCopiedDemo] = useState(false);
  const [saveStatus, setSaveStatus] = useState("載入中");
  const [activityStatus, setActivityStatus] = useState("準備編輯");
  const [mindStatus, setMindStatus] = useState<MindStatus>("missing");
  const [mindProgress, setMindProgress] = useState(0);
  const [mindError, setMindError] = useState<string | null>(null);

  const sortedLayers = useMemo(() => [...project.layers].sort((a, b) => a.order - b.order), [project.layers]);
  const selectedLayer = project.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const viewerUrl = `${window.location.origin}/viewer/${project.id}`;
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const mobileDemoMessage = isLocalhost
    ? "手機不能開 localhost。請在電腦執行 npm run tunnel，複製 Cloudflare HTTPS URL 到手機，或部署到 Netlify。"
    : `手機可開啟：${viewerUrl}`;

  const saveProjectNow = useCallback(async (nextProject: ARProject) => {
    await projectRepository.saveProject(serializableProject(nextProject));
    setSaveStatus("已自動保存");
  }, []);

  const updateProject = useCallback((updater: (current: ARProject) => ARProject) => {
    setProject((current) => updater(current));
  }, []);

  const updateLayer = useCallback(
    (layerId: string, updater: (layer: ARLayer) => ARLayer) => {
      updateProject((current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === layerId ? updater(layer) : layer)),
      }));
    },
    [updateProject],
  );

  useEffect(() => {
    selectedLayerRef.current = selectedLayerId;
  }, [selectedLayerId]);

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
        setSelectedLayerId(layers[0]?.id ?? null);
        setMindStatus(stored.mindTargetId || mindTargetUrl ? "ready" : "missing");
        setActivityStatus("專案已載入");
        setSaveStatus("已自動保存");
      })
      .catch((error) => {
        console.error(error);
        if (mounted) {
          setActivityStatus(`專案載入失敗：${friendlyError(error)}`);
          setSaveStatus("載入失敗");
        }
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveStatus("保存中");
    saveTimerRef.current = window.setTimeout(() => {
      projectRepository
        .saveProject(serializableProject(project))
        .then(() => setSaveStatus("已自動保存"))
        .catch((error) => {
          console.error(error);
          setSaveStatus("保存失敗");
          setActivityStatus(`保存失敗：${friendlyError(error)}`);
        });
    }, 450);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [project]);

  useEffect(() => {
    if (mindStatus !== "compiling") {
      setMindStatus(project.mindTargetId || project.mindTargetUrl ? "ready" : "missing");
    }
  }, [project.mindTargetId, project.mindTargetUrl, mindStatus]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#bfc2c5");
    const camera = new THREE.PerspectiveCamera(50, viewport.clientWidth / viewport.clientHeight, 0.01, 100);
    camera.position.set(0, 0.18, 2.65);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.08, 0);
    orbit.enableDamping = true;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
    });
    transform.addEventListener("objectChange", () => {
      const layerId = selectedLayerRef.current;
      const object = transform.object;
      if (!layerId || !object) return;
      updateLayer(layerId, (layer) => ({
        ...layer,
        position: { x: object.position.x, y: object.position.y, z: object.position.z },
        rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
        scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      }));
    });
    scene.add(transform.getHelper());

    const grid = new THREE.GridHelper(8, 32, "#6d7480", "#8f969e");
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    scene.add(new THREE.AmbientLight("#ffffff", 1));

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    orbitRef.current = orbit;
    transformRef.current = transform;

    const resize = () => {
      if (!viewportRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = viewportRef.current.clientWidth;
      const height = viewportRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener("resize", resize);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [updateLayer]);

  useEffect(() => {
    transformRef.current?.setMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    let cancelled = false;
    const scene = sceneRef.current;
    if (!scene) return;

    if (triggerMeshRef.current) {
      scene.remove(triggerMeshRef.current);
      triggerMeshRef.current.geometry.dispose();
      if (Array.isArray(triggerMeshRef.current.material)) {
        triggerMeshRef.current.material.forEach((material) => material.dispose());
      } else {
        triggerMeshRef.current.material.dispose();
      }
      triggerMeshRef.current = null;
    }

    if (!project.triggerImageUrl) return;
    new THREE.TextureLoader().load(project.triggerImageUrl, (texture) => {
      if (cancelled || !sceneRef.current) return;
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), material);
      mesh.position.set(0, 0, -0.01);
      triggerMeshRef.current = mesh;
      sceneRef.current.add(mesh);
    });

    return () => {
      cancelled = true;
    };
  }, [project.triggerImageUrl]);

  useEffect(() => {
    let cancelled = false;
    const scene = sceneRef.current;
    const transform = transformRef.current;
    if (!scene || !transform) return;

    layerMeshesRef.current.forEach((mesh) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.userData.video?.pause();
    });
    layerMeshesRef.current.clear();
    transform.detach();

    Promise.all(project.layers.map((layer) => createLayerMesh(layer).catch(() => null))).then((meshes) => {
      if (cancelled || !sceneRef.current) return;
      meshes.forEach((mesh) => {
        if (!mesh) return;
        layerMeshesRef.current.set(mesh.userData.layerId, mesh);
        sceneRef.current!.add(mesh);
      });
      const selected = selectedLayerRef.current ? layerMeshesRef.current.get(selectedLayerRef.current) : undefined;
      if (selected) transformRef.current?.attach(selected);
    });

    return () => {
      cancelled = true;
    };
  }, [project.layers]);

  useEffect(() => {
    const mesh = selectedLayerId ? layerMeshesRef.current.get(selectedLayerId) : undefined;
    if (mesh) transformRef.current?.attach(mesh);
    else transformRef.current?.detach();
  }, [selectedLayerId]);

  useEffect(() => {
    project.layers.forEach((layer) => {
      const mesh = layerMeshesRef.current.get(layer.id);
      if (!mesh) return;
      applyLayerTransform(mesh, layer);
      updateChromaKeyMaterial(mesh.material, layer.chromaKey, layer.opacity);
      const active = playhead >= layer.startTime && playhead <= layer.endTime;
      mesh.visible = layer.visible && (!isPlaying || active);
      if (mesh.userData.video) {
        mesh.userData.video.loop = layer.loop;
        if (isPlaying && active) void mesh.userData.video.play().catch(() => undefined);
        else mesh.userData.video.pause();
      }
    });
  }, [project.layers, isPlaying, playhead]);

  useEffect(() => {
    if (!isPlaying) return;
    let previous = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setPlayhead((current) => {
        const next = current + delta;
        return next > project.duration ? 0 : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, project.duration]);

  const handleTriggerUpload = async (file: File) => {
    try {
      setMindError(null);
      setActivityStatus("正在上傳 Trigger Image");
      const asset = await projectRepository.uploadAsset(project.id, file, "trigger");
      updateProject((current) => ({ ...current, triggerImageId: asset.id, triggerImageUrl: asset.url, thumbnailUrl: asset.url }));
      setActivityStatus("Trigger Image 已更新");

      setMindStatus("compiling");
      setMindProgress(0);
      setActivityStatus("正在編譯 .mind");
      const mindFile = await compileMindTarget(file, (progress) => {
        const normalized = progress > 1 ? progress : progress * 100;
        const percentage = Math.max(0, Math.min(100, Math.round(normalized)));
        setMindProgress(percentage);
        setActivityStatus(`正在編譯 .mind ${percentage}%`);
      });
      const mindAsset = await projectRepository.uploadAsset(project.id, mindFile, "mind");
      setProject((current) => {
        const next = { ...current, mindTargetId: mindAsset.id, mindTargetUrl: mindAsset.url };
        void saveProjectNow(next).catch((error) => {
          console.error(error);
          setSaveStatus("保存失敗");
          setActivityStatus(`.mind 已產生，但保存失敗：${friendlyError(error)}`);
        });
        return next;
      });
      setMindProgress(100);
      setMindStatus("ready");
      setActivityStatus(".mind 已自動產生");
    } catch (error) {
      console.error(error);
      setMindStatus("failed");
      setMindError(friendlyError(error));
      setActivityStatus(".mind 產生失敗，請手動上傳");
    }
  };

  const handleMindUpload = async (file: File) => {
    try {
      setMindError(null);
      setActivityStatus("正在上傳 .mind Target");
      const asset = await projectRepository.uploadAsset(project.id, file, "mind");
      setProject((current) => {
        const next = { ...current, mindTargetId: asset.id, mindTargetUrl: asset.url };
        void saveProjectNow(next).catch((error) => {
          console.error(error);
          setSaveStatus("保存失敗");
          setActivityStatus(`.mind 已上傳，但保存失敗：${friendlyError(error)}`);
        });
        return next;
      });
      setMindProgress(100);
      setMindStatus("ready");
      setActivityStatus(".mind Target 已上傳");
    } catch (error) {
      console.error(error);
      setMindStatus("failed");
      setMindError(friendlyError(error));
      setActivityStatus(`.mind 上傳失敗：${friendlyError(error)}`);
    }
  };

  const handleLayerUploads = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    let skipped = 0;
    const createdLayers: ARLayer[] = [];
    const baseOrder = project.layers.length;
    setActivityStatus(`正在上傳 ${files.length} 個圖層`);

    for (const file of files) {
      const type = fileToLayerKind(file);
      if (!type) {
        skipped += 1;
        continue;
      }

      const asset = await projectRepository.uploadAsset(project.id, file, "layer");
      createdLayers.push({
        ...createLayer(type, asset.id, file.name, baseOrder + createdLayers.length),
        assetUrl: asset.url,
      });
    }

    if (createdLayers.length > 0) {
      updateProject((current) => ({ ...current, layers: [...current.layers, ...createdLayers] }));
      setSelectedLayerId(createdLayers[0].id);
    }

    setActivityStatus(`新增 ${createdLayers.length} 個圖層${skipped ? `，略過 ${skipped} 個不支援檔案` : ""}`);
  };

  const removeLayer = (layerId: string) => {
    updateProject((current) => {
      const layers = current.layers.filter((layer) => layer.id !== layerId).map((layer, index) => ({ ...layer, order: index }));
      return { ...current, layers };
    });
    setSelectedLayerId((current) => (current === layerId ? null : current));
  };

  const moveLayer = (layerId: string, direction: -1 | 1) => {
    updateProject((current) => {
      const layers = [...current.layers].sort((a, b) => a.order - b.order);
      const index = layers.findIndex((layer) => layer.id === layerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) return current;
      const [layer] = layers.splice(index, 1);
      layers.splice(nextIndex, 0, layer);
      return { ...current, layers: layers.map((item, order) => ({ ...item, order, position: { ...item.position, z: order * 0.04 + 0.04 } })) };
    });
  };

  const copyViewerUrl = async () => {
    await navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const copyDemoInstruction = async () => {
    await navigator.clipboard.writeText(isLocalhost ? "npm run tunnel" : viewerUrl);
    setCopiedDemo(true);
    window.setTimeout(() => setCopiedDemo(false), 1200);
  };

  return (
    <main className="app-shell">
      <aside className="rail">
        <button className="rail-button active" title="Settings">
          <SlidersHorizontal size={18} />
        </button>
        <button className="rail-button" title="Layers">
          <Layers size={18} />
        </button>
        <button className="rail-button" title="Transform">
          <Move3D size={18} />
        </button>
      </aside>

      <section className="settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">WebAR Editor</span>
            <h1>{project.name}</h1>
          </div>
          <span className="status-dot">{saveStatus}</span>
        </div>

        <div className={`mind-status-card ${mindStatus}`}>
          <strong>{mindLabel(mindStatus, mindProgress)}</strong>
          <span>{activityStatus}</span>
          {mindError && <small>{mindError}</small>}
        </div>

        <div className="upload-grid">
          <label className="upload-tile">
            <Upload size={18} />
            <span>Trigger Image</span>
            <input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && handleTriggerUpload(event.target.files[0])} />
          </label>
          <label className="upload-tile">
            <Box size={18} />
            <span>.mind Target</span>
            <input type="file" accept=".mind" onChange={(event) => event.target.files?.[0] && handleMindUpload(event.target.files[0])} />
          </label>
          <label className="upload-tile wide">
            <Upload size={18} />
            <span>新增圖片 / 影片圖層（可多選）</span>
            <input type="file" accept="image/*,video/*" multiple onChange={(event) => event.target.files && handleLayerUploads(event.target.files)} />
          </label>
        </div>

        <div className="section-title">
          <Layers size={16} />
          <span>圖層</span>
        </div>
        <div className="layer-list">
          {sortedLayers.length === 0 && <p className="empty-copy">尚未加入圖層。請上傳圖片或影片，然後在 3D 空間調整位置與深度。</p>}
          {sortedLayers.map((layer) => (
            <button className={`layer-row ${layer.id === selectedLayerId ? "selected" : ""}`} key={layer.id} onClick={() => setSelectedLayerId(layer.id)}>
              {layer.type === "image" ? <Image size={16} /> : <Video size={16} />}
              <span>{layer.name}</span>
              <small>{layer.assetName}</small>
            </button>
          ))}
        </div>

        {selectedLayer && (
          <div className="layer-settings">
            <div className="layer-toolbar">
              <input className="name-input" value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, (layer) => ({ ...layer, name: event.target.value }))} />
              <button title="顯示/隱藏" onClick={() => updateLayer(selectedLayer.id, (layer) => ({ ...layer, visible: !layer.visible }))}>
                {selectedLayer.visible ? <Eye size={17} /> : <EyeOff size={17} />}
              </button>
              <button title="刪除圖層" onClick={() => removeLayer(selectedLayer.id)}>
                <Trash2 size={17} />
              </button>
            </div>

            <div className="axis-grid">
              <NumberField label="X" value={selectedLayer.position.x} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "position.x", value))} />
              <NumberField label="Y" value={selectedLayer.position.y} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "position.y", value))} />
              <NumberField label="Z" value={selectedLayer.position.z} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "position.z", value))} />
              <NumberField label="RX" value={selectedLayer.rotation.x} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "rotation.x", value))} />
              <NumberField label="RY" value={selectedLayer.rotation.y} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "rotation.y", value))} />
              <NumberField label="RZ" value={selectedLayer.rotation.z} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "rotation.z", value))} />
              <NumberField label="SX" value={selectedLayer.scale.x} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "scale.x", value))} />
              <NumberField label="SY" value={selectedLayer.scale.y} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "scale.y", value))} />
              <NumberField label="SZ" value={selectedLayer.scale.z} onChange={(value) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "scale.z", value))} />
            </div>

            <label className="field">
              <span>Opacity</span>
              <input type="range" min="0" max="1" step="0.01" value={selectedLayer.opacity} onChange={(event) => updateLayer(selectedLayer.id, (layer) => ({ ...layer, opacity: Number(event.target.value) }))} />
              <strong>{selectedLayer.opacity.toFixed(2)}</strong>
            </label>

            <div className="section-title">
              <MousePointer2 size={16} />
              <span>背景透明化</span>
            </div>
            <label className="toggle-row">
              <span>啟用色鍵去背</span>
              <input type="checkbox" checked={selectedLayer.chromaKey.enabled} onChange={(event) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "chromaKey.enabled", event.target.checked))} />
            </label>
            <label className="field">
              <span>Color</span>
              <input type="color" value={selectedLayer.chromaKey.color} onChange={(event) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "chromaKey.color", event.target.value))} />
              <button className="ghost-button" title="吸管功能預留">吸管</button>
            </label>
            <label className="field">
              <span>Threshold</span>
              <input type="range" min="0" max="0.8" step="0.01" value={selectedLayer.chromaKey.threshold} onChange={(event) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "chromaKey.threshold", Number(event.target.value)))} />
              <strong>{selectedLayer.chromaKey.threshold.toFixed(2)}</strong>
            </label>
            <label className="field">
              <span>Softness</span>
              <input type="range" min="0" max="0.5" step="0.01" value={selectedLayer.chromaKey.softness} onChange={(event) => updateLayer(selectedLayer.id, (layer) => setPath(layer, "chromaKey.softness", Number(event.target.value)))} />
              <strong>{selectedLayer.chromaKey.softness.toFixed(2)}</strong>
            </label>

            <div className="timeline-card">
              <NumberField label="Start" value={selectedLayer.startTime} step={0.1} onChange={(value) => updateLayer(selectedLayer.id, (layer) => ({ ...layer, startTime: value }))} />
              <NumberField label="End" value={selectedLayer.endTime} step={0.1} onChange={(value) => updateLayer(selectedLayer.id, (layer) => ({ ...layer, endTime: value }))} />
              <label className="toggle-row">
                <span>Loop</span>
                <input type="checkbox" checked={selectedLayer.loop} onChange={(event) => updateLayer(selectedLayer.id, (layer) => ({ ...layer, loop: event.target.checked }))} />
              </label>
              <div className="order-buttons">
                <button onClick={() => moveLayer(selectedLayer.id, -1)}>上移</button>
                <button onClick={() => moveLayer(selectedLayer.id, 1)}>下移</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="workspace">
        <header className="topbar">
          <div className="mode-group">
            <button className={transformMode === "translate" ? "active" : ""} onClick={() => setTransformMode("translate")} title="Move">
              <Move3D size={17} />
            </button>
            <button className={transformMode === "rotate" ? "active" : ""} onClick={() => setTransformMode("rotate")} title="Rotate">
              <RotateCcw size={17} />
            </button>
            <button className={transformMode === "scale" ? "active" : ""} onClick={() => setTransformMode("scale")} title="Scale">
              <Box size={17} />
            </button>
          </div>
          <div className="publish-group">
            <span className={`mind-pill ${mindStatus}`}>{mindLabel(mindStatus, mindProgress)}</span>
            <button onClick={copyViewerUrl}>{copied ? <Check size={17} /> : <Copy size={17} />} Viewer URL</button>
            <button className="demo-url-button" onClick={copyDemoInstruction}>
              {isLocalhost && <AlertTriangle size={16} />}
              {copiedDemo ? "已複製" : "手機 Demo"}
            </button>
            <a href={viewerUrl} target="_blank" rel="noreferrer" onClick={() => updateProject((current) => ({ ...current, status: "published" }))}>
              Publish
            </a>
          </div>
        </header>

        {isLocalhost && (
          <div className="mobile-demo-banner">
            <AlertTriangle size={16} />
            <span>{mobileDemoMessage}</span>
          </div>
        )}

        <div className="viewport" ref={viewportRef} />

        <footer className="timeline">
          <button className="play-button" onClick={() => setIsPlaying((current) => !current)} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <span>{formatSeconds(playhead)}</span>
          <input type="range" min="0" max={project.duration} step="0.01" value={playhead} onChange={(event) => setPlayhead(Number(event.target.value))} />
          <span>{formatSeconds(project.duration)}</span>
        </footer>
      </section>
    </main>
  );
};
