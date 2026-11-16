/** Previews keep their own database/session; production marketing links go to app. */
export function platformHref(path: string): string {
  return process.env.NEXT_PUBLIC_APP_ENV === 'qa' || process.env.NEXT_PUBLIC_APP_ENV === 'local'
    ? path : `https://app.yaqeenbiz.com${path}`;
}
