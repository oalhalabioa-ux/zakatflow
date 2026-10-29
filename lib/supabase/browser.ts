import { createBrowserClient } from '@supabase/ssr';
import {supabaseUrl} from './config';
export function supabaseBrowser(){ return createBrowserClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {cookieOptions:{sameSite:'lax',secure:typeof location!=='undefined'&&location.protocol==='https:'}}); }
