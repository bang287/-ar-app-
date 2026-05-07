import { useEffect, useMemo, useRef, useState } from "react";
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
    mindTarget: "direct official URL",
    mindarStart: "not started",
    targetFoundCount: "0",
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

    let mindarThree: MindARThreeInstance | null = null;
    try {
      setStatus("檢查手機相機權限");
      setDebug((current) => ({ ...current, camera: "requesting native getUserMedia", mindarStart: "not started", targetFoundCount: "0" }));
      const stream = await withTimeout(requestCameraStream(), 10000, "Camera permission check timed out after 10 seconds");
      const [track] = stream.getVideoTracks();
      setDebug((current) => ({ ...current, camera: `granted: ${track?.label || "camera stream"}` }));
      stopMediaStream(stream);

      setStatus("載入 MindAR runtime");
      const runtime = await loadMindARThree();
      setDebug((current) => ({ ...current, runtime: `loaded: ${runtime.source}`, mindTarget: "direct official URL" }));

      mindarThree = new runtime.MindARThree({
        container: containerRef.current,
        imageTargetSrc: officialMindUrl,
        maxTrack: 1,
        uiLoading: "yes",
        uiScanning: "yes",
        uiError: "yes",
      });
      const { renderer, scene, camera } = mindarThree;
      const anchor = mindarThree.addAnchor(0);
      const marker = new runtime.THREE.Mesh(
        new runtime.THREE.PlaneGeometry(1, 0.55),
        new runtime.THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85 }),
      );
      marker.position.z = 0.04;
      anchor.group.add(marker);

      let targetFoundCount = 0;
      anchor.onTargetFound = () => {
        targetFoundCount += 1;
        setDebug((current) => ({ ...current, targetFoundCount: String(targetFoundCount) }));
        setMode("tracking");
        setStatus("官方 smoke test 已辨識 target");
      };
      anchor.onTargetLost = () => {
        setMode("lost");
        setStatus("相機已啟動，請掃描官方 target image");
      };

      cleanupRef.current = () => {
        marker.geometry.dispose();
        marker.material.dispose();
        renderer.setAnimationLoop(null);
        try {
          mindarThree?.stop();
        } catch {
          // Ignore half-started MindAR stop errors.
        }
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
      ["targetFoundCount", debug.targetFoundCount],
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
            <p>這頁照官方範例直接使用官方 .mind URL。若這頁可辨識，專案問題通常在 Trigger 圖或 .mind。</p>
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
