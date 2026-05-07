import { MIND_AR_COMPILER_VERSION } from "./mindVersion";

type MindCompiler = {
  compileImageTargets: (images: HTMLImageElement[], onProgress?: (progress: number) => void) => Promise<unknown>;
  exportData: () => Promise<ArrayBuffer>;
};

type MindAREsmModule = {
  Compiler?: new () => MindCompiler;
};

const compilerModuleUrl = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";

const loadMindARCompiler = async () => {
  const loaded = (await import(/* @vite-ignore */ compilerModuleUrl)) as MindAREsmModule;
  if (!loaded.Compiler) throw new Error("MindAR 1.2.5 compiler loaded without Compiler export");
  return loaded.Compiler;
};

const loadImageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read trigger image for .mind compilation"));
    };
    image.src = url;
  });

const normalizeImage = async (source: HTMLImageElement) => {
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(source.naturalWidth || source.width, source.naturalHeight || source.height));
  if (scale >= 1) return source;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((source.naturalWidth || source.width) * scale));
  canvas.height = Math.max(1, Math.round((source.naturalHeight || source.height) * scale));
  const context = canvas.getContext("2d");
  if (!context) return source;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to normalize trigger image for .mind compilation"));
    image.src = canvas.toDataURL("image/jpeg", 0.92);
  });
};

const mindFileName = (fileName: string) => {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "target";
  return `${base}.mind`;
};

export const compileMindTarget = async (file: File, onProgress?: (progress: number) => void) => {
  const Compiler = await loadMindARCompiler();
  const image = await normalizeImage(await loadImageFromFile(file));
  const compiler = new Compiler();
  await compiler.compileImageTargets([image], onProgress);
  const buffer = await compiler.exportData();
  return new File([buffer], mindFileName(file.name), { type: "application/octet-stream" });
};

export { MIND_AR_COMPILER_VERSION };
