import type { ARProject } from "../types/project";
import { projectRepository } from "./projectRepository";

export const hydrateRuntimeProject = async (stored: ARProject): Promise<ARProject> => {
  const triggerImageUrl = stored.triggerImageUrl ?? (await projectRepository.createObjectUrl(stored.triggerImageId));
  const mindTargetUrl = stored.mindTargetUrl ?? (await projectRepository.createObjectUrl(stored.mindTargetId));
  const layers = await Promise.all(
    stored.layers.map(async (layer) => ({
      ...layer,
      assetUrl: layer.assetUrl ?? (await projectRepository.createObjectUrl(layer.assetId)),
    })),
  );

  return {
    ...stored,
    triggerImageUrl,
    mindTargetUrl,
    layers,
  };
};
