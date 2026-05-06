export type LayerKind = "image" | "video";

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type ChromaKeySettings = {
  enabled: boolean;
  color: string;
  threshold: number;
  softness: number;
};

export type ProjectStatus = "draft" | "published";

export type ARFolder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ARLayer = {
  id: string;
  name: string;
  type: LayerKind;
  assetId: string;
  assetUrl?: string;
  assetName?: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  opacity: number;
  visible: boolean;
  order: number;
  startTime: number;
  endTime: number;
  loop: boolean;
  chromaKey: ChromaKeySettings;
};

export type ARProject = {
  id: string;
  folderId?: string;
  name: string;
  triggerImageId?: string;
  triggerImageUrl?: string;
  mindTargetId?: string;
  mindTargetUrl?: string;
  thumbnailUrl?: string;
  status: ProjectStatus;
  recognitionScore: number;
  viewsMonth: number;
  duration: number;
  layers: ARLayer[];
  createdAt: string;
  updatedAt: string;
};

export type UploadedAsset = {
  id: string;
  name: string;
  type: string;
  url: string;
};

export type StoredAsset = {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: string;
};
