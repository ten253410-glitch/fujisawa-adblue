import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase =
  process.env.NEXT_PUBLIC_ENABLE_CLOUD === "true" && url && key
    ? createClient(url, key)
    : null;
