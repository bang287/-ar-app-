import * as THREE from "three";

export type MindARAnchor = {
  group: THREE.Group;
  onTargetFound?: () => void;
  onTargetLost?: () => void;
};

export type MindARThreeInstance = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  addAnchor: (targetIndex: number) => MindARAnchor;
  start: () => Promise<void>;
  stop: () => void;
};

export type MindARThreeConstructor = new (options: {
  container: HTMLElement;
  imageTargetSrc: string;
  maxTrack?: number;
  uiLoading?: "yes" | "no";
  uiScanning?: "yes" | "no";
  uiError?: "yes" | "no";
}) => MindARThreeInstance;

type MindAREsmModule = {
  MindARThree?: MindARThreeConstructor;
};

type MindARGlobal = {
  IMAGE?: {
    MindARThree?: MindARThreeConstructor;
  };
};

const cdnModuleUrl = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

const globalMindAR = () => (window as Window & { MINDAR?: MindARGlobal }).MINDAR?.IMAGE?.MindARThree;

export const loadMindARThree = async () => {
  const existing = globalMindAR();
  if (existing) return { MindARThree: existing, source: "global" };

  const errors: string[] = [];
  for (const specifier of ["mindar-image-three", cdnModuleUrl]) {
    try {
      const loaded = (await import(/* @vite-ignore */ specifier)) as MindAREsmModule;
      if (loaded.MindARThree) return { MindARThree: loaded.MindARThree, source: specifier === "mindar-image-three" ? "esm-importmap" : "esm-cdn" };
      errors.push(`${specifier} loaded without MindARThree export`);
    } catch (error) {
      errors.push(error instanceof Error ? `${specifier}: ${error.message}` : `${specifier}: ${String(error)}`);
    }
  }

  const afterImport = globalMindAR();
  if (afterImport) return { MindARThree: afterImport, source: "global-after-import" };

  throw new Error(`Unable to load MindAR runtime. ${errors.join(" | ")}`);
};

export const withTimeout = async <T,>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> => {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(label)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};
