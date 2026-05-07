import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ArrowLeft, Camera, Clipboard, ExternalLink, RefreshCw } from "lucide-react";
import { buildInfo } from "../buildInfo";
import { requestCameraStream, stopMediaStream } from "../ar/camera";
import { loadMindARThree, type MindARThreeInstance, withTimeout } from "../ar/mindRuntime";

const officialMindUrl = "https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@master/examples/image-tracking/assets/card-example/card.mind";
const officialTargetImageUrl = "https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@master/examples/image-tracking/assets/card-example/card.png";

type SmokeMode = "idle" | "starting" | "tracking" | "lost" | "error";

const formatBuildTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-Hant", { hour12: false });
};

const fetchObjectUrl = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to fetch official .mind: ${response.status} ${response.statusText}`);
  const blob = await response.blob();
  return {
    objectUrl: URL.createObjectURL(blob),
    detail: `${response.status} OK, ${blob.size} bytes`,
  };
};

export const MindARSmokeTest = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<SmokeMode>("idle");
  const [status, setStatus] = useState("官方 MindAR runtime 測試");
  const [copied, setCopied] = useState(false);
  const [debug, setDebug] = useState({
    build: `${buildInfo.version} / ${formatBuildTime(buildInfo.builtAt)}`,
    camera: "not tested",
    runtime: "not loaded",
    mindTarget: "not loaded",
    mindarStart: "not started",
    browser: navigator.userAgent,
  });

  const clearStage = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    containerRef.current?.querySelectorAll("canvas, video").forEach((node) => node.remove());
  };

  useEffect(() => () => clearStage(), []);

  const startSmokeTest = async () => {
    if (!containerRef.current) return;
    clearStage();
    setMode("starting");

    let objectUrl: string | null = null;
    let mindarThree: MindARThreeInstance | null = null;
    let marker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    try {
      setStatus("下載官方 .mind target");
      setDebug((current) => ({ ...current, mindTarget: "downloading", mindarStart: "not started" }));
      const target = await withTimeout(fetchObjectUrl(officialMindUrl), 15000, "Official .mind download timeout");
      objectUrl = target.objectUrl;
      setDebug((current) => ({ ...current, mindTarget: target.detail }));

      setStatus("檢查手機相機權限");
      setDebug((current) => ({ ...current, camera: "requesting native getUserMedia" }));
      const stream = await withTimeout(requestCameraStream(), 10000, "Camera permission check timed out after 10 seconds");
      const [track] = stream.getVideoTracks();
      setDebug((current) => ({ ...current, camera: `granted: ${track?.label || "camera stream"}` }));
      stopMediaStream(stream);

      setStatus("載入 MindAR runtime");
      const runtime = await loadMindARThree();
      setDebug((current) => ({ ...current, runtime: `loaded: ${runtime.source}` }));

      mindarThree = new runtime.MindARThree({
        container: containerRef.current,
        imageTargetSrc: objectUrl,
        maxTrack: 1,
        uiLoading: "yes",
        uiScanning: "yes",
        uiError: "yes",
      });
      const { renderer, scene, camera } = mindarThree;
      const anchor = mindarThree.addAnchor(0);
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.55), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85 }));
      marker.position.z = 0.04;
      anchor.group.add(marker);

      anchor.onTargetFound = () => {
        setMode("tracking");
        setStatus("官方 smoke test 已辨識 target");
      };
      anchor.onTargetLost = () => {
        setMode("lost");
        setStatus("相機已啟動，請掃描官方 target image");
      };

      cleanupRef.current = () => {
        marker?.geometry.dispose();
        marker?.material.dispose();
        renderer.setAnimationLoop(null);
        try {
          mindarThree?.stop();
        } catch {
          // Ignore half-started MindAR stop errors.
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };

      setStatus("啟動官方 MindAR 測試");
      setDebug((current) => ({ ...current, mindarStart: "starting" }));
      await withTimeout(mindarThree.start(), 60000, "Official MindAR smoke test timeout after 60 seconds");
      setDebug((current) => ({ ...current, mindarStart: "resolved" }));
      setMode("lost");
      setStatus("相機已啟動，請掃描官方 target image");
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    } catch (error) {
      console.error(error);
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const message = error instanceof Error ? error.message : "MindAR smoke test failed";
      setDebug((current) => ({ ...current, mindarStart: `failed: ${message}` }));
      setMode("error");
      setStatus(message);
    }
  };

  const debugRows = useMemo(
    () => [
      ["origin", window.location.origin],
      ["build", debug.build],
      ["camera", debug.camera],
      ["runtime", debug.runtime],
      ["mindTarget", debug.mindTarget],
      ["mindarStart", debug.mindarStart],
      ["browser", debug.browser],
    ],
    [debug],
  );
  const debugText = debugRows.map(([label, value]) => `${label}: ${value}`).join("\n");

  const copyDebug = async () => {
    await navigator.clipboard.writeText(debugText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="viewer-shell">
      <div className="viewer-stage ar-test-stage" ref={containerRef}>
        <div className="viewer-hud">
          <a href="/" title="Back to gallery">
            <ArrowLeft size={18} />
          </a>
          <div>
            <span>MindAR Smoke Test</span>
            <strong>{status}</strong>
          </div>
          <Camera size={18} />
        </div>

        {(mode === "idle" || mode === "error") && (
          <div className="viewer-start-panel">
            <button onClick={startSmokeTest}>
              <Camera size={22} />
              Start Smoke Test
            </button>
            <a className="viewer-panel-link" href={officialTargetImageUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              官方 target image
            </a>
            <button className="secondary" onClick={copyDebug}>
              <Clipboard size={19} />
              {copied ? "Copied" : "Copy Debug"}
            </button>
            <img className="smoke-target-thumb" src={officialTargetImageUrl} alt="Official MindAR target" />
            <p>這頁只測官方 MindAR runtime。若這頁也一直轉圈，問題在 runtime/瀏覽器；若這頁可用，專案需要重新產生 .mind。</p>
          </div>
        )}

        <div className={`viewer-debug-panel ${mode === "starting" || mode === "tracking" || mode === "lost" ? "compact" : ""}`}>
          <div className="viewer-debug-heading">
            <strong>Smoke Debug</strong>
            <div>
              <button onClick={copyDebug} title="Copy debug">
                <Clipboard size={14} />
              </button>
              <button onClick={startSmokeTest} title="Restart">
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
        </div>
      </div>
    </main>
  );
};
