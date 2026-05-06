import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

export const supabaseBucket = (import.meta.env.VITE_SUPABASE_BUCKET as string | undefined) ?? "ar-assets";

export const dataBackend = ((import.meta.env.VITE_DATA_BACKEND as string | undefined) ?? "auto").toLowerCase();
