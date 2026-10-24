// Browsers set Sec-Fetch-Site themselves; scripts cannot forge this header.
// Hostinger may reconstruct request.url with its internal HTTP origin behind TLS.
const hostedOrigins = new Set([
  'https://yaqeenbiz.com',
  'https://www.yaqeenbiz.com',
  'https://app.yaqeenbiz.com',
]);

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  if (origin === new URL(request.url).origin) return true;
  // Do not trust caller-supplied forwarded host/protocol headers. Require the
  // browser's same-origin signal and an exact deployed HTTPS origin instead.
  return site === 'same-origin' && hostedOrigins.has(origin);
}
