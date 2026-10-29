import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {supabaseUrl} from './config';

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createSupabaseServerClient(
    supabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {sameSite:'lax',secure:process.env.NODE_ENV==='production'},
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components may not be able to write cookies.
          }
        },
      },
    }
  );
}

/*
 * Compatibility exports used by existing routes/services.
 */
export async function createServerSupabase() {
  return supabaseServer();
}

export async function createServerClient() {
  return supabaseServer();
}

export async function supabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_NOT_CONFIGURED');
  }

  return createSupabaseClient(
    supabaseUrl(),
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
