import type { ARLayer, ChromaKeySettings } from "../types/project";
import type { RuntimeThree } from "./mindRuntime";

export type RuntimeLayerMesh = InstanceType<RuntimeThree["Mesh"]> & {
  userData: {
    layerId: string;
    video?: HTMLVideoElement;
  };
  geometry: InstanceType<RuntimeThree["PlaneGeometry"]>;
  material: InstanceType<RuntimeThree["ShaderMaterial"]>;
};

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

const createChromaKeyMaterial = (
  THREE: RuntimeThree,
  texture: InstanceType<RuntimeThree["Texture"]>,
  chromaKey: ChromaKeySettings,
  opacity: number,
) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: texture },
      keyColor: { value: new THREE.Color(chromaKey.color) },
      threshold: { value: chromaKey.threshold },
      softness: { value: Math.max(0.001, chromaKey.softness) },
      opacity: { value: opacity },
      enabled: { value: chromaKey.enabled ? 1 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 keyColor;
      uniform float threshold;
      uniform float softness;
      uniform float opacity;
      uniform float enabled;
      varying vec2 vUv;

      void main() {
        vec4 texel = texture2D(map, vUv);
        float colorDistance = distance(texel.rgb, keyColor);
        float chromaAlpha = smoothstep(threshold, threshold + softness, colorDistance);
        float finalAlpha = mix(texel.a, texel.a * chromaAlpha, enabled) * opacity;
        if (finalAlpha < 0.01) discard;
        gl_FragColor = vec4(texel.rgb, finalAlpha);
      }
    `,
  });
};

const createVideoTexture = (THREE: RuntimeThree, url: string) => {
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

export const applyRuntimeLayerTransform = (mesh: RuntimeLayerMesh, layer: ARLayer) => {
  mesh.position.set(layer.position.x, layer.position.y, layer.position.z);
  mesh.rotation.set(layer.rotation.x, layer.rotation.y, layer.rotation.z);
  mesh.scale.set(layer.scale.x, layer.scale.y, layer.scale.z);
  mesh.visible = layer.visible;
  mesh.renderOrder = layer.order;
};

export const createRuntimeLayerMesh = async (THREE: RuntimeThree, layer: ARLayer): Promise<RuntimeLayerMesh> => {
  if (!layer.assetUrl) throw new Error(`Layer ${layer.id} has no asset URL`);

  let video: HTMLVideoElement | undefined;
  let dimensions = { width: 1, height: 1 };
  const texture =
    layer.type === "video"
      ? await (async () => {
          const result = createVideoTexture(THREE, layer.assetUrl!);
          video = result.video;
          await waitForVideoMetadata(video);
          dimensions = dimensionsFromAspect(video.videoWidth, video.videoHeight);
          return result.texture;
        })()
      : await new THREE.TextureLoader().loadAsync(layer.assetUrl).then((loadedTexture) => {
          const image = loadedTexture.image as HTMLImageElement | ImageBitmap | undefined;
          dimensions = dimensionsFromAspect(image?.width, image?.height);
          return loadedTexture;
        });

  const geometry = new THREE.PlaneGeometry(dimensions.width, dimensions.height);
  const material = createChromaKeyMaterial(THREE, texture, layer.chromaKey, layer.opacity);
  const mesh = new THREE.Mesh(geometry, material) as RuntimeLayerMesh;
  mesh.userData.layerId = layer.id;
  mesh.userData.video = video;
  applyRuntimeLayerTransform(mesh, layer);
  return mesh;
};
