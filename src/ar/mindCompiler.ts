type MindCompiler = {
  compileImageTargets: (images: HTMLImageElement[], onProgress?: (progress: number) => void) => Promise<unknown>;
  exportData: () => Promise<ArrayBuffer>;
};

type MindARCompilerGlobal = {
  Compiler: new () => MindCompiler;
};

const compilerScriptUrls = [
  "https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.1.4/dist/mindar-image.prod.js",
  "https://cdn.jsdelivr.net/npm/mind-ar@1.1.5/dist/mindar-image.prod.js",
  "https://cdn.jsdelivr.net/npm/mind-ar@1.1.4/dist/mindar-image.prod.js",
  "https://cdn.jsdelivr.net/npm/mind-ar@1.1.3/dist/mindar-image.prod.js",
  "https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@0.4.2/dist/mindar.prod-min.js",
];

const getMindAR = () => (window as Window & { MINDAR?: MindARCompilerGlobal }).MINDAR;

const loadScript = (url: string) =>
  new Promise<void>((resolve, reject) => {
    const existingScript = Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-mindar-compiler-src]")).find(
      (script) => script.dataset.mindarCompilerSrc === url,
    );
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error(`Unable to load MindAR compiler script: ${url}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.dataset.mindarCompilerSrc = url;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Unable to load MindAR compiler script: ${url}`));
    document.head.appendChild(script);
  });

const loadMindARCompilerScript = async () => {
  const existing = getMindAR();
  if (existing?.Compiler) return existing;

  const errors: string[] = [];
  for (const url of compilerScriptUrls) {
    try {
      await loadScript(url);
      const mindar = getMindAR();
      if (mindar?.Compiler) return mindar;
      errors.push(`${url} loaded without Compiler API`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`MindAR Compiler API unavailable. ${errors.join(" | ")}`);
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

const mindFileName = (fileName: string) => {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "target";
  return `${base}.mind`;
};

export const compileMindTarget = async (file: File, onProgress?: (progress: number) => void) => {
  const mindar = await loadMindARCompilerScript();
  const image = await loadImageFromFile(file);
  const compiler = new mindar.Compiler();
  await compiler.compileImageTargets([image], onProgress);
  const buffer = await compiler.exportData();
  return new File([buffer], mindFileName(file.name), { type: "application/octet-stream" });
};
