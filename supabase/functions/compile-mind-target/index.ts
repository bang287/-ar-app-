import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CompileRequest = {
  projectId?: string;
  triggerImagePath?: string;
  bucket?: string;
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const defaultBucket = Deno.env.get("SUPABASE_BUCKET") ?? "ar-assets";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY function secret" }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as CompileRequest;
  const projectId = body.projectId;
  const triggerImagePath = body.triggerImagePath;
  const bucket = body.bucket ?? defaultBucket;
  if (!projectId || !triggerImagePath) {
    return json({ error: "projectId and triggerImagePath are required" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: triggerFile, error: downloadError } = await supabase.storage.from(bucket).download(triggerImagePath);
  if (downloadError || !triggerFile) {
    return json({ error: downloadError?.message ?? "Unable to read trigger image" }, 404);
  }

  // MindAR's open-source compiler currently depends on browser Canvas and Web Worker APIs.
  // Supabase Edge Runtime is Deno-based and does not provide that browser worker/canvas environment.
  // The frontend caller intentionally falls back to the browser compiler when this response is returned,
  // so users still only upload the trigger image once and never need to upload .mind manually.
  return json(
    {
      error: "MindAR server compiler is not available in Supabase Edge Runtime yet",
      fallback: "browser-compiler",
      projectId,
      triggerImagePath,
      triggerBytes: triggerFile.size,
    },
    501,
  );
});
