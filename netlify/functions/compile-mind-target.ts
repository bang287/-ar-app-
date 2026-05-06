import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

type CompileRequest = {
  projectId?: string;
  triggerImagePath?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  status: "draft" | "published";
  folder_id: string | null;
  thumbnail_path: string | null;
  project_json: Record<string, unknown>;
};

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

const json = (payload: unknown, status = 200) =>
  Response.json(payload, {
    status,
  });

const env = (key: string, fallbackKey?: string) => Netlify.env.get(key) ?? (fallbackKey ? Netlify.env.get(fallbackKey) : undefined);

const compileMindTargetOnServer = async (_triggerImage: Blob) => {
  // MindAR's compiler currently relies on browser Canvas/WebWorker or native canvas packages.
  // The native path pulls node-canvas, which is not reliable in this project/Netlify build.
  // Returning a clear error lets the Editor automatically fall back to the browser compiler
  // while keeping a stable backend API for a later worker-capable compiler service.
  throw new Error("MindAR server compiler is not available in this Netlify Function runtime");
};

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = env("SUPABASE_URL", "VITE_SUPABASE_URL");
  const supabaseKey = env("SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_ANON_KEY");
  const bucket = env("SUPABASE_BUCKET", "VITE_SUPABASE_BUCKET") ?? "ar-assets";
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "Missing Supabase environment variables" }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as CompileRequest;
  if (!body.projectId || !body.triggerImagePath) {
    return json({ error: "projectId and triggerImagePath are required" }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data: triggerImage, error: downloadError } = await supabase.storage.from(bucket).download(body.triggerImagePath);
  if (downloadError || !triggerImage) {
    return json({ error: downloadError?.message ?? "Unable to read trigger image" }, 404);
  }

  try {
    const mindBlob = await compileMindTargetOnServer(triggerImage);
    const mindTargetId = `projects/${body.projectId}/trigger/${Date.now()}_target.mind`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(mindTargetId, mindBlob, {
      cacheControl: "3600",
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: projectRow, error: readError } = await supabase.from("projects").select("*").eq("id", body.projectId).single();
    if (readError) throw readError;

    const project = projectRow as ProjectRow;
    const nextJson = {
      ...(project.project_json ?? {}),
      mindTargetId,
      mindTargetUrl: undefined,
    };
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        project_json: nextJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.projectId);
    if (updateError) throw updateError;

    const mindTargetUrl = supabase.storage.from(bucket).getPublicUrl(mindTargetId).data.publicUrl;
    return json({ mindTargetId, mindTargetUrl, source: "netlify-function" });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unable to compile .mind on the backend",
        fallback: "browser-compiler",
      },
      501,
    );
  }
};

export const config: Config = {
  path: "/api/compile-mind-target",
};
