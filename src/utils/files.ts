import type { LayerKind } from "../types/project";

export const fileToLayerKind = (file: File): LayerKind | null => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
};

export const formatSeconds = (seconds: number) => {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = Math.floor(clamped % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

export const setPath = <T extends object>(target: T, path: string, value: number | string | boolean): T => {
  const keys = path.split(".");
  const clone = structuredClone(target) as Record<string, unknown>;
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i += 1) {
    cursor = cursor[keys[i]] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
  return clone as T;
};
