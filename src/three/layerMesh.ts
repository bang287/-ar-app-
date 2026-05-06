import * as THREE from "three";
import type { ARLayer } from "../types/project";
import { createChromaKeyMaterial } from "./chromaKeyMaterial";

export type LayerMesh = THREE.Mesh<THREE.PlaneGeometry, ReturnType<typeof createChromaKeyMaterial>> & {
  userData: {
    layerId: string;
    video?: HTMLVideoElement;
  };
};

const textureLoader = new THREE.TextureLoader();

const dimensionsFromAspect = (width?: number, height?: number) => {
  const safeWidth = width && width > 0 ? width : 1;
  const safeHeight = height && height > 0 ? height : 1;
  const aspect = safeWidth / safeHeight;
  if (aspect >= 1) return { width: aspect, height: 1 };
  return { width: 1, height: 1 / aspect };
};

const waitForVideoMetadata = (video: HTMLVideoElement) =>
  new Promise<void>((resolve) => {
    if (video.readyState >= 1 && video.videoWidth > 0) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("error", done);
      resolve();
    };
    video.addEventListener("loadedmetadata", done, { once: true });
    video.addEventListener("error", done, { once: true });
    video.load();
  });

const createVideoTexture = (url: string) => {
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, video };
};

export const createLayerMesh = async (layer: ARLayer): Promise<LayerMesh> => {
  if (!layer.assetUrl) throw new Error(`Layer ${layer.id} has no asset URL`);

  let video: HTMLVideoElement | undefined;
  let dimensions = { width: 1, height: 1 };
  const texture =
    layer.type === "video"
      ? await (async () => {
          const result = createVideoTexture(layer.assetUrl!);
          video = result.video;
          await waitForVideoMetadata(video);
          dimensions = dimensionsFromAspect(video.videoWidth, video.videoHeight);
          return result.texture;
        })()
      : await textureLoader.loadAsync(layer.assetUrl).then((loadedTexture) => {
          const image = loadedTexture.image as HTMLImageElement | ImageBitmap | undefined;
          dimensions = dimensionsFromAspect(image?.width, image?.height);
          return loadedTexture;
        });

  const geometry = new THREE.PlaneGeometry(dimensions.width, dimensions.height);
  const material = createChromaKeyMaterial(texture, layer.chromaKey, layer.opacity);
  const mesh = new THREE.Mesh(geometry, material) as LayerMesh;
  mesh.userData.layerId = layer.id;
  mesh.userData.video = video;
  applyLayerTransform(mesh, layer);
  return mesh;
};

export const applyLayerTransform = (mesh: THREE.Object3D, layer: ARLayer) => {
  mesh.position.set(layer.position.x, layer.position.y, layer.position.z);
  mesh.rotation.set(layer.rotation.x, layer.rotation.y, layer.rotation.z);
  mesh.scale.set(layer.scale.x, layer.scale.y, layer.scale.z);
  mesh.visible = layer.visible;
  mesh.renderOrder = layer.order;
};
