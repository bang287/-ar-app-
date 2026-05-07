import type * as THREE from "three";

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

export type RuntimeThree = typeof import("three");

type MindAREsmModule = {
  MindARThree?: MindARThreeConstructor;
};

type MindARGlobal = {
  IMAGE?: {
    MindARThree?: MindARThreeConstructor;
  };
};

const cdnModuleUrl = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";
const threeCdnModuleUrl = "https://unpkg.com/three@0.160.0/build/three.module.js";

const globalMindAR = () => (window as Window & { MINDAR?: MindARGlobal }).MINDAR?.IMAGE?.MindARThree;

const loadRuntimeThree = async () => {
  const errors: string[] = [];
  for (const specifier of ["three", threeCdnModuleUrl]) {
    try {
      return {
        THREE: (await import(/* @vite-ignore */ specifier)) as RuntimeThree,
        threeSource: specifier === "three" ? "importmap-three" : "three-cdn",
      };
    } catch (error) {
      errors.push(error instanceof Error ? `${specifier}: ${error.message}` : `${specifier}: ${String(error)}`);
    }
  }
  throw new Error(`Unable to load MindAR Three.js runtime dependency. ${errors.join(" | ")}`);
};

export const loadMindARThree = async () => {
  const runtimeThree = await loadRuntimeThree();
  const existing = globalMindAR();
  if (existing) return { MindARThree: existing, ...runtimeThree, source: `global+${runtimeThree.threeSource}` };

  const errors: string[] = [];
  for (const specifier of ["mindar-image-three", cdnModuleUrl]) {
    try {
      const loaded = (await import(/* @vite-ignore */ specifier)) as MindAREsmModule;
      if (loaded.MindARThree) {
        return {
          MindARThree: loaded.MindARThree,
          ...runtimeThree,
          source: `${specifier === "mindar-image-three" ? "esm-importmap" : "esm-cdn"}+${runtimeThree.threeSource}`,
        };
      }
      errors.push(`${specifier} loaded without MindARThree export`);
    } catch (error) {
      errors.push(error instanceof Error ? `${specifier}: ${error.message}` : `${specifier}: ${String(error)}`);
    }
  }

  const afterImport = globalMindAR();
  if (afterImport) return { MindARThree: afterImport, ...runtimeThree, source: `global-after-import+${runtimeThree.threeSource}` };

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
