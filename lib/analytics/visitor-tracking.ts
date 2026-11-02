/** The Vercel Web Analytics endpoint is only guaranteed on this Vercel-hosted domain. */
export const VERCEL_ANALYTICS_HOST = 'app.yaqeenbiz.com';

export function shouldTrackVisitor(hostname: string, production: boolean): boolean {
  return production && hostname.toLowerCase() === VERCEL_ANALYTICS_HOST;
}
