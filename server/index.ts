import express from "express";
import multer from "multer";
import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import type { Request } from "express";

type Vec3 = { x: number; y: number; z: number };
type ChromaKeySettings = { enabled: boolean; color: string; threshold: number; softness: number };
type ARLayer = {
  id: string;
  name: string;
  type: "image" | "video";
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
type ARFolder = { id: string; name: string; createdAt: string; updatedAt: string };
type ARProject = {
  id: string;
  folderId?: string;
  name: string;
  triggerImageId?: string;
  triggerImageUrl?: string;
  mindTargetId?: string;
  mindTargetUrl?: string;
  thumbnailUrl?: string;
  status: "draft" | "published";
  recognitionScore: number;
  viewsMonth: number;
  duration: number;
  layers: ARLayer[];
  createdAt: string;
  updatedAt: string;
};

const app = express();
const port = Number(process.env.API_PORT ?? 8787);
const workspaceRoot = process.cwd();
const projectsRoot = path.resolve(workspaceRoot, "local-projects");
const foldersFile = path.join(projectsRoot, "folders.json");
const allowedUploadKinds = new Set(["trigger", "layer", "mind", "thumb"]);
const allowedMimePrefixes = ["image/", "video/"];

app.use(express.json({ limit: "2mb" }));

const ensureWithinRoot = (target: string) => {
  const resolved = path.resolve(target);
  if (resolved !== projectsRoot && !resolved.startsWith(`${projectsRoot}${path.sep}`)) {
    throw new Error("Path escapes local-projects");
  }
  return resolved;
};

const sanitizeSegment = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "file";

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

const projectDir = (projectId: string) => ensureWithinRoot(path.join(projectsRoot, sanitizeSegment(projectId)));
const projectJson = (projectId: string) => path.join(projectDir(projectId), "project.json");

const ensureProjectDirs = async (projectId: string) => {
  const root = projectDir(projectId);
  await fs.mkdir(path.join(root, "trigger"), { recursive: true });
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  await fs.mkdir(path.join(root, "thumbs"), { recursive: true });
};

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
};

const writeJson = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const createProject = (name: string, folderId?: string): ARProject => {
  const now = new Date().toISOString();
  return {
    id: `project_${crypto.randomUUID()}`,
    folderId,
    name: name.trim() || "Untitled AR Project",
    status: "draft",
    recognitionScore: 0,
    viewsMonth: 0,
    duration: 15,
    layers: [],
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeProject = (project: ARProject): ARProject => {
  const baseUrl = `/api/projects/${encodeURIComponent(project.id)}/files`;
  const triggerImageUrl = project.triggerImageId ? `${baseUrl}/${project.triggerImageId}` : undefined;
  const mindTargetUrl = project.mindTargetId ? `${baseUrl}/${project.mindTargetId}` : undefined;
  return {
    ...project,
    triggerImageUrl,
    mindTargetUrl,
    thumbnailUrl: project.thumbnailUrl ?? triggerImageUrl,
    layers: project.layers.map((layer) => ({
      ...layer,
      assetUrl: layer.assetId ? `${baseUrl}/${layer.assetId}` : layer.assetUrl,
    })),
  };
};

const storage = multer.diskStorage({
  destination: async (req: Request, _file, cb) => {
    try {
      const kind = String(req.query.kind ?? "layer");
      const projectId = sanitizeSegment(firstParam(req.params.id));
      if (!allowedUploadKinds.has(kind)) throw new Error("Unsupported upload kind");
      await ensureProjectDirs(projectId);
      const dir = kind === "trigger" || kind === "mind" ? "trigger" : kind === "thumb" ? "thumbs" : "assets";
      cb(null, ensureWithinRoot(path.join(projectDir(projectId), dir)));
    } catch (error) {
      cb(error as Error, "");
    }
  },
  filename: (_req: Request, file, cb) => {
    cb(null, `${Date.now()}_${crypto.randomUUID()}_${sanitizeSegment(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const kind = String(req.query.kind ?? "layer");
    const isMind = kind === "mind" && file.originalname.toLowerCase().endsWith(".mind");
    const isMedia = allowedMimePrefixes.some((prefix) => file.mimetype.startsWith(prefix));
    cb(null, isMind || isMedia);
  },
});

const getFolders = async () => readJson<ARFolder[]>(foldersFile, []);

const listProjects = async () => {
  await fs.mkdir(projectsRoot, { recursive: true });
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readJson<ARProject | null>(path.join(projectsRoot, entry.name, "project.json"), null)),
  );
  return projects.filter((project): project is ARProject => Boolean(project)).map(normalizeProject);
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, projectsRoot });
});

app.get("/api/folders", async (_req, res, next) => {
  try {
    res.json(await getFolders());
  } catch (error) {
    next(error);
  }
});

app.post("/api/folders", async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const folder: ARFolder = {
      id: `folder_${crypto.randomUUID()}`,
      name: String(req.body?.name ?? "New Folder").trim() || "New Folder",
      createdAt: now,
      updatedAt: now,
    };
    await writeJson(foldersFile, [...(await getFolders()), folder]);
    res.status(201).json(folder);
  } catch (error) {
    next(error);
  }
});

app.put("/api/folders/:id", async (req, res, next) => {
  try {
    const folderId = firstParam(req.params.id);
    const folders = await getFolders();
    const index = folders.findIndex((folder) => folder.id === folderId);
    if (index < 0) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }
    const next = {
      ...folders[index],
      name: String(req.body?.name ?? folders[index].name).trim() || folders[index].name,
      updatedAt: new Date().toISOString(),
    };
    folders[index] = next;
    await writeJson(foldersFile, folders);
    res.json(next);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/folders/:id", async (req, res, next) => {
  try {
    const folderId = firstParam(req.params.id);
    const folders = await getFolders();
    const nextFolders = folders.filter((folder) => folder.id !== folderId);
    if (nextFolders.length === folders.length) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }
    await writeJson(foldersFile, nextFolders);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects", async (_req, res, next) => {
  try {
    res.json(await listProjects());
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (req, res, next) => {
  try {
    const project = createProject(String(req.body?.name ?? "Untitled AR Project"), req.body?.folderId);
    await ensureProjectDirs(project.id);
    await writeJson(projectJson(project.id), project);
    res.status(201).json(normalizeProject(project));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id", async (req, res, next) => {
  try {
    const project = await readJson<ARProject | null>(projectJson(firstParam(req.params.id)), null);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(normalizeProject(project));
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:id", async (req, res, next) => {
  try {
    const existing = await readJson<ARProject | null>(projectJson(req.params.id), null);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const incoming = req.body as ARProject;
    const saved: ARProject = {
      ...incoming,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      triggerImageUrl: undefined,
      mindTargetUrl: undefined,
      thumbnailUrl: undefined,
      layers: incoming.layers.map((layer) => ({ ...layer, assetUrl: undefined })),
    };
    await writeJson(projectJson(existing.id), saved);
    res.json(normalizeProject(saved));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:id", async (req, res, next) => {
  try {
    const jsonPath = projectJson(firstParam(req.params.id));
    await fs.unlink(jsonPath);
    res.status(204).send();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    next(error);
  }
});

app.post("/api/projects/:id/assets", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing or unsupported file" });
      return;
    }
    const project = await readJson<ARProject | null>(projectJson(firstParam(req.params.id)), null);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const relative = path.relative(projectDir(project.id), req.file.path).replaceAll(path.sep, "/");
    res.status(201).json({
      id: relative,
      name: req.file.originalname,
      type: req.file.mimetype || "application/octet-stream",
      url: `/api/projects/${encodeURIComponent(project.id)}/files/${relative}`,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id/files/*path", async (req, res, next) => {
  try {
    const rawPath = Array.isArray(req.params.path) ? req.params.path.join("/") : String(req.params.path);
    const filePath = ensureWithinRoot(path.join(projectDir(req.params.id), rawPath));
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(400).json({ error: error.message });
});

await fs.mkdir(projectsRoot, { recursive: true });

app.listen(port, "0.0.0.0", () => {
  console.log(`Local AR API listening on http://localhost:${port}`);
  console.log(`Projects root: ${projectsRoot}`);
});
