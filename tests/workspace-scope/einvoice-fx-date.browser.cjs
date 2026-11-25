// Actual Next/component wiring with synthetic API responses, never hosted Auth/DB.
// Run with SCOPE_UI_START_SERVER=1 and the same browser-module inputs as ui-scope.browser.cjs.
// The in-memory save/reload proves UI payloads; it is not database persistence proof.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(process.env.SCOPE_UI_BROWSER_MODULE || 'playwright-core');
const origin = process.env.SCOPE_UI_ORIGIN || 'http://127.0.0.1:3185';
assert.equal(new URL(origin).origin, origin);
assert.equal(new URL(origin).protocol, 'http:');
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic loopback only');
const out = process.env.SCOPE_UI_ARTIFACTS || '/tmp/yaqeen-einvoice-fx-date';
const org = '20000000-0000-4000-8000-000000000001';
const contact = '70000000-0000-4000-8000-000000000001';
const checks = [], pageErrors = [], requests = [], writes = [], blocked = [], serverLogs = [];
let browser, page, server, invoices = [], savedNumber = 1;
const rates = [
  { from_currency: 'USD', to_currency: 'SAR', rate: 4.25, valuation_date: '2026-12-01' },
  { from_currency: 'SAR', to_currency: 'EUR', rate: 0.2, valuation_date: '2026-12-01' },
  { from_currency: 'GBP', to_currency: 'SAR', rate: 7, valuation_date: '2026-12-01' },
  { from_currency: 'USD', to_currency: 'SAR', rate: 3.75, valuation_date: '2026-11-24' },
  { from_currency: 'SAR', to_currency: 'EUR', rate: 0.25, valuation_date: '2026-11-24' },
].map((rate, index) => ({ ...rate, id: 'rate-' + index, organization_id: org, source: 'Synthetic FX ' + index }));
const seller = {
  registered_name: 'Synthetic seller', seller_street: 'Test street', seller_building_number: '1234',
  seller_district: 'Test district', seller_additional_number: '5678', seller_city: 'Riyadh', seller_postal_code: '12345',
};
const buyer = {
  id: contact, organization_id: org, name: 'Synthetic customer', contact_type: 'CUSTOMER', vat_number: null,
  street: 'Buyer street', building_number: '4321', district: 'Buyer district', additional_number: '8765',
  city: 'Riyadh', postal_code: '54321', country_code: 'SA',
};
const line = { id: 'line', item_name: 'Synthetic service', description: null, quantity: 1, unit_code: 'PCE',
  unit_price: '100', discount_amount: '0', tax_category: 'S', tax_rate: '15', tax_amount: '15', gross_amount: '115' };
function invoice(number, status, rate, accounting = null) {
  return { id: '80000000-0000-4000-8000-' + String(number).padStart(12, '0'),
    organization_id: org, invoice_number: 'FIXTURE-' + number, document_type: 'INVOICE', invoice_category: 'STANDARD',
    status, issue_date: '2026-11-25', issue_time: '12:00:00', due_date: null, currency: 'USD',
    exchange_rate: String(rate), payable_amount: '115', tax_total_amount: '15', tax_exclusive_amount: '100',
    buyer_name: buyer.name, buyer_contact_id: contact, buyer_vat_number: null, buyer_address: buyer.street,
    buyer_building_number: buyer.building_number, buyer_district: buyer.district, buyer_city: buyer.city,
    buyer_postal_code: buyer.postal_code, buyer_additional_number: buyer.additional_number,
    accounting_document_id: accounting, lines: [line], seller_name: seller.registered_name, seller_vat_number: '300000000000003' };
}
function resetInvoices() {
  invoices = [invoice(901, 'DRAFT', 3.61), invoice(902, 'ACCOUNTING_READY', 3.62, '60000000-0000-4000-8000-000000000002'),
    invoice(903, 'ISSUED', 3.63, '60000000-0000-4000-8000-000000000003')];
}
const totals = { salesBase: '0', salesGross: '0', purchaseBase: '0', purchaseVatBeforeRecovery: '0', outputTax: '0',
  inputTax: '0', taxPayable: '0', taxCredit: '0', salesNet: '0', purchaseNet: '0', paidAmount: '0', cashReservedAmount: '0',
  filingStatus: 'NOT_FILED', dueDate: '', zeroRatedSales: '0', exemptSales: '0', outOfScopeSales: '0' };
async function check(name, run) {
  try { await run(); checks.push({ name, status: 'passed' }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, status: 'failed', error: String(error) }); throw error; }
}
async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
function form() { return page.locator('.vat-einvoice-form'); }
function rateInput() { return form().locator('.vat-einvoice-fx-rate input'); }
function hint() { return form().locator('.vat-einvoice-fx-rate small'); }
async function expectRate(expected) {
  await settled();
  assert.equal(await rateInput().inputValue(), expected);
}
async function openRegister() {
  await page.goto(origin + '/en/vat?scope=ORGANIZATION&organization=' + org + '&section=invoices', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('group', { name: 'Sales invoice source', exact: true }).getByRole('button', { name: 'ZATCA', exact: true }).click();
  await page.getByRole('heading', { name: 'Invoices and notes', exact: true }).waitFor();
  await page.locator('.vat-einvoice-item').filter({ hasText: 'FIXTURE-901' }).waitFor();
}
async function newInvoice(currency = 'USD', date = '2026-11-25') {
  await openRegister();
  const panel = page.locator('.vat-panel').filter({ has: page.getByRole('heading', { name: 'Invoices and notes', exact: true }) });
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await panel.getByRole('group', { name: 'New document type', exact: true }).getByRole('button', { name: /^Invoice/ }).click();
  await form().getByLabel('Invoice date', { exact: true }).fill(date);
  await form().getByRole('button', { name: 'Edit fields', exact: true }).click();
  await form().getByRole('combobox', { name: 'Currency', exact: true }).selectOption(currency);
  await rateInput().waitFor();
}
async function invoiceAction(number, action) {
  await openRegister();
  await page.getByRole('button', { name: 'Invoice FIXTURE-' + number + ' actions', exact: true }).click();
  await page.getByRole('group', { name: 'Invoice FIXTURE-' + number + ' actions', exact: true }).getByRole('button', { name: action, exact: true }).click();
  await form().waitFor();
}
async function completeAndSave() {
  await form().getByLabel('Customer / buyer', { exact: true }).selectOption(contact);
  await form().getByLabel('Choose line 1 description', { exact: true }).selectOption('Synthetic service');
  await form().getByLabel('Line 1 unit price', { exact: true }).fill('100');
  await form().getByRole('button', { name: 'Save as draft', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Invoice draft saved.' }).waitFor();
}

(async () => {
  await mkdir(out, { recursive: true });
  if (process.env.SCOPE_UI_START_SERVER === '1') {
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', new URL(origin).port], {
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
        NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_APP_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', FINANCIAL_BUDGET_UI_QA: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverLogs.push(String(data)); if (serverLogs.length > 100) serverLogs.shift(); });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(origin + '/en/login', { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch {}
      await delay(300);
    }
    assert.ok(ready, 'Local Next must start');
  }
  const launch = { headless: true };
  if (process.env.SCOPE_UI_CHROMIUM_MODULE) {
    const binary = (await import(pathToFileURL(process.env.SCOPE_UI_CHROMIUM_MODULE).href)).default;
    launch.executablePath = await binary.executablePath(); launch.args = binary.args;
  }
  browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(({ org }) => {
    localStorage.setItem('zf-theme', 'yaqeen-business'); localStorage.setItem('zf-workspace-scope', 'ORGANIZATION');
    localStorage.setItem('zf-liquidity-org', org); sessionStorage.setItem('zf-liquidity-org', org);
  }, { org });
  resetInvoices();
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { blocked.push({ origin: url.origin }); return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: url.pathname, method: request.method() });
    if (request.method() !== 'GET') {
      const body = request.postDataJSON(); writes.push({ path: url.pathname, method: request.method(), body });
      assert.equal(body.organization_id, org, 'Synthetic write must stay in fixture company');
      if (url.pathname === '/api/vat/invoice-numbering' && request.method() === 'POST') return route.fulfill({ status: 200, json: { invoice_number: 'SAVED-' + savedNumber } });
      if (url.pathname === '/api/vat' && body.action === 'add_document') return route.fulfill({ status: 201, json: { id: '60000000-0000-4000-8000-000000000001' } });
      if (url.pathname === '/api/vat/e-invoices' && request.method() === 'POST') {
        const saved = { ...invoice(savedNumber++, 'DRAFT', body.exchange_rate, body.accounting_document_id), ...body,
          payable_amount: '115', tax_total_amount: '15', tax_exclusive_amount: '100', lines: [{ ...line, ...body.lines[0] }] };
        invoices.push(saved); return route.fulfill({ status: 201, json: saved });
      }
      blocked.push({ path: url.pathname, method: request.method() });
      return route.fulfill({ status: 400, json: { error: 'UNEXPECTED_SYNTHETIC_WRITE' } });
    }
    let json = [];
    if (url.pathname === '/api/settings') json = { profile: { name: 'Synthetic actor', base_currency: 'SAR' } };
    if (url.pathname === '/api/organizations') json = [{ id: org, name: 'Synthetic company', base_currency: 'SAR' }];
    if (url.pathname === '/api/currencies') json = ['SAR', 'USD', 'EUR', 'GBP'].map(code => ({ code, name_en: code, name_ar: code, decimals: 2, active: true }));
    if (url.pathname === '/api/fx') json = rates;
    if (url.pathname === '/api/liquidity') json = { accounts: [], flows: [] };
    if (url.pathname === '/api/vat') json = {
      profile: { ...seller, organization_id: org, registration_status: 'REGISTERED', tax_registration_number: '300000000000003',
        standard_rate: 15, filing_frequency: 'QUARTERLY', period_start_month: 1 },
      period: { from: '2026-10-01', to: '2026-12-31' }, yearStart: '2026-01-01',
      periodSummary: null, periodTotals: totals, annualTotals: totals, documents: [], service_catalog: ['Synthetic service'],
    };
    if (url.pathname === '/api/vat/contacts') json = { can_manage: false, contacts: [buyer] };
    if (url.pathname === '/api/vat/invoice-numbering') json = { initialized: true, next_number: 'SAVED-' + savedNumber };
    if (url.pathname === '/api/vat/e-invoices') json = { is_admin: true, invoices };
    return route.fulfill({ status: 200, json });
  });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await check('New ZATCA invoice selects the dated quote for field, hint and both save payloads', async () => {
    await newInvoice(); await expectRate('3.75');
    assert.match(await hint().innerText(), /2026-11-24/); assert.doesNotMatch(await hint().innerText(), /2026-12-01/);
    const before = writes.length; await completeAndSave();
    const sent = writes.slice(before);
    for (const endpoint of ['/api/vat', '/api/vat/e-invoices']) {
      const save = sent.find(write => write.path === endpoint);
      assert.ok(save, 'Expected ' + endpoint); assert.equal(save.body.exchange_rate, 3.75);
      assert.equal(save.body[endpoint === '/api/vat' ? 'transaction_date' : 'issue_date'], '2026-11-25');
    }
    await openRegister();
    await page.getByRole('button', { name: 'Invoice SAVED-1 actions', exact: true }).click();
    await page.getByRole('group', { name: 'Invoice SAVED-1 actions', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await expectRate('3.75');
  });
  await check('Automatic rate and hint follow the invoice date across an effective-date boundary', async () => {
    await newInvoice(); await expectRate('3.75');
    await form().getByLabel('Invoice date', { exact: true }).fill('2026-12-01'); await expectRate('4.25');
    assert.match(await hint().innerText(), /2026-12-01/);
    await form().getByLabel('Invoice date', { exact: true }).fill('2026-11-25'); await expectRate('3.75');
    assert.match(await hint().innerText(), /2026-11-24/);
  });
  await check('Inverse and future-only rates honor the invoice date without a fallback to future data', async () => {
    await newInvoice('EUR'); await expectRate('4'); assert.match(await hint().innerText(), /2026-11-24/);
    await form().getByRole('combobox', { name: 'Currency', exact: true }).selectOption('GBP');
    await expectRate(''); assert.match(await hint().innerText(), /No saved exchange rate.*invoice date/);
    assert.equal(await form().getByRole('button', { name: 'Save as draft', exact: true }).isDisabled(), true);
  });
  await check('A manual rate survives date changes and both saves; changing currency starts a new default', async () => {
    await newInvoice(); await rateInput().fill('3.83');
    await form().getByLabel('Invoice date', { exact: true }).fill('2026-12-01'); await expectRate('3.83');
    assert.match(await hint().innerText(), /Manual rate/);
    const before = writes.length; await completeAndSave();
    for (const endpoint of ['/api/vat', '/api/vat/e-invoices']) {
      const save = writes.slice(before).find(write => write.path === endpoint);
      assert.ok(save, 'Expected manual-rate save to ' + endpoint);
      assert.equal(save.body.exchange_rate, 3.83);
    }
    await newInvoice(); await rateInput().fill('3.83');
    await form().getByRole('combobox', { name: 'Currency', exact: true }).selectOption('EUR'); await expectRate('4');
  });
  for (const [number, action, expected] of [[901, 'Edit', '3.61'], [902, 'Prepare ZATCA draft', '3.62'], [903, 'Credit note', '3.63']]) {
    await check('Saved source ' + number + ' keeps its rate when the invoice date changes', async () => {
      await invoiceAction(number, action); await expectRate(expected);
      await form().getByLabel('Invoice date', { exact: true }).fill('2026-12-01'); await expectRate(expected);
      assert.match(await hint().innerText(), /Saved.*rate/);
    });
  }
  assert.deepEqual(pageErrors, [], 'No client runtime errors');
  assert.deepEqual(blocked, [], 'No off-loopback requests or unexpected writes');
})().catch(async error => {
  console.error(error); process.exitCode = 1;
  if (page) await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
}).finally(async () => {
  await writeFile(out + '/results.json', JSON.stringify({ evidence: 'SYNTHETIC_API_ACTUAL_NEXT_UI', databasePersistence: false,
    checks, pageErrors, blocked, writes: writes.map(write => ({ path: write.path, method: write.method, rate: write.body.exchange_rate })) }, null, 2));
  await writeFile(out + '/next.log', serverLogs.join(''));
  if (browser) await browser.close();
  if (server) { server.kill('SIGTERM'); await delay(250); }
});
