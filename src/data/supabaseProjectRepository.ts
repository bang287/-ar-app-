import type { ARFolder, ARProject, UploadedAsset } from "../types/project";
import { createDefaultProject } from "./defaultProject";
import { dataBackend, supabase, supabaseBucket, supabaseConfigured } from "./supabaseClient";

type FolderRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  folder_id: string | null;
  name: string;
  status: "draft" | "published";
  thumbnail_path: string | null;
  project_json: ARProject;
  created_at: string;
  updated_at: string;
};

const toFolder = (row: FolderRow): ARFolder => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const storagePublicUrl = (path?: string | null) => {
  if (!path || !supabase) return undefined;
  return supabase.storage.from(supabaseBucket).getPublicUrl(path).data.publicUrl;
};

const hydrateProject = (row: ProjectRow): ARProject => {
  const json = row.project_json ?? createDefaultProject();
  return {
    ...json,
    id: row.id,
    folderId: row.folder_id ?? undefined,
    name: row.name,
    status: row.status,
    thumbnailUrl: storagePublicUrl(row.thumbnail_path ?? json.triggerImageId),
    triggerImageUrl: storagePublicUrl(json.triggerImageId),
    mindTargetUrl: storagePublicUrl(json.mindTargetId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    layers: (json.layers ?? []).map((layer) => ({
      ...layer,
      assetUrl: storagePublicUrl(layer.assetId),
    })),
  };
};

const dehydrateProject = (project: ARProject): ARProject => ({
  ...project,
  triggerImageUrl: undefined,
  mindTargetUrl: undefined,
  thumbnailUrl: undefined,
  layers: project.layers.map((layer) => ({ ...layer, assetUrl: undefined })),
});

const requireSupabase = () => {
  if (!supabase) throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  return supabase;
};

const sanitizeFileName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 90) || "file";

const assetDir = (kind: "trigger" | "layer" | "mind" | "thumb") => {
  if (kind === "trigger" || kind === "mind") return "trigger";
  if (kind === "thumb") return "thumbs";
  return "assets";
};

export const shouldUseSupabase = () => dataBackend === "supabase" || (dataBackend === "auto" && supabaseConfigured);

export const supabaseProjectRepository = {
  configured: supabaseConfigured,

  async listFolders() {
    const client = requireSupabase();
    const { data, error } = await client.from("folders").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data as FolderRow[]).map(toFolder);
  },

  async createFolder(name: string) {
    const client = requireSupabase();
    const { data, error } = await client.from("folders").insert({ name }).select("*").single();
    if (error) throw error;
    return toFolder(data as FolderRow);
  },

  async updateFolder(folderId: string, name: string) {
    const client = requireSupabase();
    const { data, error } = await client
      .from("folders")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", folderId)
      .select("*")
      .single();
    if (error) throw error;
    return toFolder(data as FolderRow);
  },

  async deleteFolder(folderId: string) {
    const client = requireSupabase();
    const { error } = await client.from("folders").delete().eq("id", folderId);
    if (error) throw error;
  },

  async listProjects() {
    const client = requireSupabase();
    const { data, error } = await client.from("projects").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    return (data as ProjectRow[]).map(hydrateProject);
  },

  async createProject(name: string, folderId?: string) {
    const client = requireSupabase();
    const project = { ...createDefaultProject(), id: crypto.randomUUID(), name, folderId, createdAt: new Date().toISOString() };
    const { data, error } = await client
      .from("projects")
      .insert({
        id: project.id,
        folder_id: folderId ?? null,
        name,
        status: project.status,
        thumbnail_path: null,
        project_json: dehydrateProject(project),
      })
      .select("*")
      .single();
    if (error) throw error;
    return hydrateProject(data as ProjectRow);
  },

  async getProject(id: string) {
    const client = requireSupabase();
    const { data, error } = await client.from("projects").select("*").eq("id", id).single();
    if (error) throw error;
    return hydrateProject(data as ProjectRow);
  },

  async saveProject(project: ARProject) {
    const client = requireSupabase();
    const stored = dehydrateProject(project);
    const { error } = await client
      .from("projects")
      .update({
        folder_id: project.folderId ?? null,
        name: project.name,
        status: project.status,
        thumbnail_path: project.triggerImageId ?? null,
        project_json: stored,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    if (error) throw error;
  },

  async deleteProject(projectId: string) {
    const client = requireSupabase();
    const { error } = await client.from("projects").delete().eq("id", projectId);
    if (error) throw error;
  },

  async uploadAsset(projectId: string, file: File, kind: "trigger" | "layer" | "mind" | "thumb" = "layer") {
    const client = requireSupabase();
    const path = `projects/${projectId}/${assetDir(kind)}/${Date.now()}_${crypto.randomUUID()}_${sanitizeFileName(file.name)}`;
    const { error } = await client.storage.from(supabaseBucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (error) throw error;

    return {
      id: path,
      name: file.name,
      type: file.type || "application/octet-stream",
      url: storagePublicUrl(path) ?? "",
    } satisfies UploadedAsset;
  },
};
