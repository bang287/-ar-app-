import type { ARLayer, ARProject, LayerKind } from "../types/project";

export const createId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export const createDefaultProject = (): ARProject => ({
  id: "local-demo",
  name: "New AR Artwork",
  status: "draft",
  recognitionScore: 0,
  viewsMonth: 0,
  duration: 15,
  layers: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const createLayer = (type: LayerKind, assetId: string, fileName: string, order: number): ARLayer => ({
  id: createId("layer"),
  name: `圖層 ${order + 1}`,
  type,
  assetId,
  assetName: fileName,
  position: { x: 0, y: 0, z: order * 0.04 + 0.04 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  opacity: 1,
  visible: true,
  order,
  startTime: 0,
  endTime: 15,
  loop: true,
  chromaKey: {
    enabled: false,
    color: "#00ff00",
    threshold: 0.18,
    softness: 0.08,
  },
});
