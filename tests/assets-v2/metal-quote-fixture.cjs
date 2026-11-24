// QA canary for server-side provider calls, including those invisible to Chromium.
const {appendFileSync} = require('node:fs');
const original = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (['alyawmgold.com','xaus.com'].includes(url.hostname)) {
    appendFileSync(process.env.ASSET_PROVIDER_TRACE, url.hostname+'\n');
    return Promise.resolve(new Response(null,{status:429}));
  }
  return original(input, options);
};
