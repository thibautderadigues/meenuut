import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  // PKCE : le lien magique revient avec ?code=…, sans toucher au hash du routeur (#/d/:id).
  { auth: { flowType: 'pkce' } },
);
