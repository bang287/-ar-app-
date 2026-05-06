import { createDefaultProject } from "./defaultProject";
import type { ARFolder, ARProject, MindCompileResult, StoredAsset, UploadedAsset } from "../types/project";
import { shouldUseSupabase, supabaseProjectRepository } from "./supabaseProjectRepository";

const DB_NAME = "webar-layer-editor";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const ASSET_STORE = "assets";
const FOLDER_STORE = "folders";

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE)) {
        db.createObjectStore(FOLDER_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txStore = async (storeName: string, mode: IDBTransactionMode) => {
  const db = await openDb();
  return db.transaction(storeName, mode).objectStore(storeName);
};

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const projectRepository = {
  async apiAvailable() {
    try {
      const response = await fetch("/api/health");
      return response.ok;
    } catch {
      return false;
    }
  },

  async listFolders() {
    if (shouldUseSupabase()) return supabaseProjectRepository.listFolders();
    if (await this.apiAvailable()) {
      const response = await fetch("/api/folders");
      if (response.ok) return (await response.json()) as ARFolder[];
    }
    const store = await txStore(FOLDER_STORE, "readonly");
    return requestToPromise<ARFolder[]>(store.getAll());
  },

  async createFolder(name: string) {
    if (shouldUseSupabase()) return supabaseProjectRepository.createFolder(name);
    if (await this.apiAvailable()) {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("Unable to create folder");
      return (await response.json()) as ARFolder;
    }
    const now = new Date().toISOString();
    const folder: ARFolder = { id: `folder_${crypto.randomUUID()}`, name, createdAt: now, updatedAt: now };
    const store = await txStore(FOLDER_STORE, "readwrite");
    await requestToPromise(store.put(folder));
    return folder;
  },

  async updateFolder(folderId: string, name: string) {
    if (shouldUseSupabase()) return supabaseProjectRepository.updateFolder(folderId, name);
    if (await this.apiAvailable()) {
      const response = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("Unable to update folder");
      return (await response.json()) as ARFolder;
    }
    const store = await txStore(FOLDER_STORE, "readwrite");
    const folder = await requestToPromise<ARFolder | undefined>(store.get(folderId));
    if (!folder) throw new Error("Folder not found");
    const next = { ...folder, name, updatedAt: new Date().toISOString() };
    await requestToPromise(store.put(next));
    return next;
  },

  async deleteFolder(folderId: string) {
    if (shouldUseSupabase()) return supabaseProjectRepository.deleteFolder(folderId);
    if (await this.apiAvailable()) {
      const response = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete folder");
      return;
    }
    const store = await txStore(FOLDER_STORE, "readwrite");
    await requestToPromise(store.delete(folderId));
  },

  async listProjects() {
    if (shouldUseSupabase()) return supabaseProjectRepository.listProjects();
    if (await this.apiAvailable()) {
      const response = await fetch("/api/projects");
      if (response.ok) return (await response.json()) as ARProject[];
    }
    const store = await txStore(PROJECT_STORE, "readonly");
    const projects = await requestToPromise<ARProject[]>(store.getAll());
    return Promise.all(
      projects.map(async (project) => ({
        ...project,
        triggerImageUrl: await this.createObjectUrl(project.triggerImageId),
        mindTargetUrl: await this.createObjectUrl(project.mindTargetId),
        thumbnailUrl: await this.createObjectUrl(project.triggerImageId),
        layers: await Promise.all(
          project.layers.map(async (layer) => ({
            ...layer,
            assetUrl: await this.createObjectUrl(layer.assetId),
          })),
        ),
      })),
    );
  },

  async createProject(name: string, folderId?: string) {
    if (shouldUseSupabase()) return supabaseProjectRepository.createProject(name, folderId);
    if (await this.apiAvailable()) {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, folderId }),
      });
      if (!response.ok) throw new Error("Unable to create project");
      return (await response.json()) as ARProject;
    }
    const project = { ...createDefaultProject(), id: `project_${crypto.randomUUID()}`, name, folderId };
    await this.saveProject(project);
    return project;
  },

  async getProject(id = "local-demo") {
    if (shouldUseSupabase()) return supabaseProjectRepository.getProject(id);
    if (await this.apiAvailable()) {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (response.ok) return (await response.json()) as ARProject;
      if (id !== "local-demo") throw new Error("Project not found");
    }
    const store = await txStore(PROJECT_STORE, "readonly");
    const project = await requestToPromise<ARProject | undefined>(store.get(id));
    if (project) return project;

    const next = createDefaultProject();
    await this.saveProject(next);
    return next;
  },

  async saveProject(project: ARProject) {
    if (shouldUseSupabase()) return supabaseProjectRepository.saveProject(project);
    if (await this.apiAvailable()) {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      if (!response.ok) throw new Error("Unable to save project");
      return;
    }
    const store = await txStore(PROJECT_STORE, "readwrite");
    await requestToPromise(store.put({ ...project, updatedAt: new Date().toISOString() }));
  },

  async deleteProject(projectId: string) {
    if (shouldUseSupabase()) return supabaseProjectRepository.deleteProject(projectId);
    if (await this.apiAvailable()) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete project");
      return;
    }
    const store = await txStore(PROJECT_STORE, "readwrite");
    await requestToPromise(store.delete(projectId));
  },

  async uploadAsset(projectId: string, file: File, kind: "trigger" | "layer" | "mind" | "thumb" = "layer") {
    if (shouldUseSupabase()) return supabaseProjectRepository.uploadAsset(projectId, file, kind);
    if (await this.apiAvailable()) {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets?kind=${encodeURIComponent(kind)}`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("Unable to upload asset");
      return (await response.json()) as UploadedAsset;
    }
    const asset = await this.saveAsset(file);
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      url: URL.createObjectURL(file),
    } satisfies UploadedAsset;
  },

  async compileMindTarget(projectId: string, triggerImagePath: string): Promise<MindCompileResult> {
    const netlifyResponse = await fetch("/api/compile-mind-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, triggerImagePath }),
    }).catch(() => null);
    if (netlifyResponse?.ok) return (await netlifyResponse.json()) as MindCompileResult;

    if (shouldUseSupabase()) return supabaseProjectRepository.compileMindTarget(projectId, triggerImagePath);
    if (await this.apiAvailable()) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/compile-mind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerImagePath }),
      });
      if (!response.ok) throw new Error("Local API cannot compile .mind yet");
      return (await response.json()) as MindCompileResult;
    }
    throw new Error("No backend .mind compiler is configured");
  },

  async saveAsset(file: File) {
    const asset: StoredAsset = {
      id: `${Date.now()}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      name: file.name,
      type: file.type,
      blob: file,
      createdAt: new Date().toISOString(),
    };
    const store = await txStore(ASSET_STORE, "readwrite");
    await requestToPromise(store.put(asset));
    return asset;
  },

  async getAsset(id: string) {
    const store = await txStore(ASSET_STORE, "readonly");
    return requestToPromise<StoredAsset | undefined>(store.get(id));
  },

  async createObjectUrl(id?: string) {
    if (!id) return undefined;
    const asset = await this.getAsset(id);
    return asset ? URL.createObjectURL(asset.blob) : undefined;
  },
};
