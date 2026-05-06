import * as THREE from "three";
import type { ChromaKeySettings } from "../types/project";

export type ChromaUniformMaterial = THREE.ShaderMaterial & {
  uniforms: {
    map: { value: THREE.Texture };
    keyColor: { value: THREE.Color };
    threshold: { value: number };
    softness: { value: number };
    opacity: { value: number };
    enabled: { value: number };
  };
};

export const createChromaKeyMaterial = (
  texture: THREE.Texture,
  chromaKey: ChromaKeySettings,
  opacity: number,
): ChromaUniformMaterial => {
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
  }) as ChromaUniformMaterial;
};

export const updateChromaKeyMaterial = (
  material: ChromaUniformMaterial,
  chromaKey: ChromaKeySettings,
  opacity: number,
) => {
  material.uniforms.keyColor.value.set(chromaKey.color);
  material.uniforms.threshold.value = chromaKey.threshold;
  material.uniforms.softness.value = Math.max(0.001, chromaKey.softness);
  material.uniforms.opacity.value = opacity;
  material.uniforms.enabled.value = chromaKey.enabled ? 1 : 0;
};
