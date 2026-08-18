import { createClient } from "@supabase/supabase-js";

export function createSupabaseBrowserClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
