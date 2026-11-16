export function verifySupabaseEnvironment(url: string | undefined, environment: string | undefined, expectedRef: string | undefined) {
 if (!url) throw new Error('SUPABASE_URL_NOT_CONFIGURED');
 if (environment === 'qa') {
  const actual = new URL(url).hostname.split('.')[0];
  if (!expectedRef || expectedRef === 'ejpzcsfwqziqxwhvqnay' || actual !== expectedRef) throw new Error('QA_DATABASE_ISOLATION_REQUIRED');
 }
 return url;
}
export function supabaseUrl() {
 return verifySupabaseEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_APP_ENV,process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF);
}
