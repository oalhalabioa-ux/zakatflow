// Injected only in isolated Chromium QA. The application still runs the normal
// provider parser, market-price storage, RLS checks and asset revaluation.
const original = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === 'https://alyawmgold.com/api/v1/spot/latest?country=SA') {
    return Promise.resolve(Response.json({
      country: {currency:'SAR'},
      metals: {
        gold: {units:{gram:420},quoteRecordedAtUtc:'2026-10-01T09:00:00Z'},
        silver: {units:{gram:5},quoteRecordedAtUtc:'2026-10-01T09:00:00Z'},
      },
    }));
  }
  return original(input, options);
};
