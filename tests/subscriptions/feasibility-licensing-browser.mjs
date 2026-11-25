import assert from 'node:assert/strict';

export async function verifyFeasibilityLicensingBrowser({ source, receiver, appUrl, sourceOrg, project }) {
  const names = {
    en: { legal: 'Legal', evidence: 'Licensing evidence', register: 'Licensing register', documents: 'Approvals and documents register', attachments: 'Licence attachments' },
    ar: { legal: 'القانون والتراخيص', evidence: 'أدلة التراخيص', register: 'سجل التراخيص', documents: 'سجل الموافقات والوثائق', attachments: 'مرفقات التراخيص' },
  };
  const requirement = 'Synthetic water abstraction licence';
  const filename = 'synthetic-water-licence.png';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0sAAAAASUVORK5CYII=', 'base64');
  const button = name => source.getByRole('button', { name, exact: true });
  const portfolio = locale => appUrl + '/' + locale + '/feasibility?' +
    new URLSearchParams({ scope: 'ORGANIZATION', organization: sourceOrg, project });
  const row = name => source.locator('.fs-register-row').filter({ has: source.locator('summary').getByText(name, { exact: true }) });
  const report = source.locator('[data-report-section="governance"]');
  const missingReference = report.getByText(requirement + ' · Evidence reference required', { exact: false });

  async function saveStudy() {
    const pending = source.waitForResponse(response => new URL(response.url()).pathname === '/api/feasibility/organization-projects' &&
      response.request().method() === 'PATCH');
    await button('Save company study').click();
    const response = await pending;
    assert.equal(response.status(), 200);
  }

  await source.goto(portfolio('en'));
  await button(names.en.legal).click();
  await button('Add requirement').click();
  const editor = row('New requirement');
  await editor.locator('summary').click();
  await editor.getByLabel('Group', { exact: true }).fill('Water resources');
  await editor.getByLabel('Status', { exact: true }).selectOption('VERIFIED');
  await editor.getByLabel('Critical requirement', { exact: true }).check();
  await editor.getByLabel('Requirement', { exact: true }).fill(requirement);
  await saveStudy();

  await button('Report and export').click();
  await missingReference.waitFor();
  await button(names.en.legal).click();
  await button('Evidence for requirement · ' + requirement).click();
  const linkTo = source.getByLabel('Link attachment to requirement', { exact: true });
  await linkTo.waitFor();
  assert.equal(await linkTo.locator('option:checked').textContent(), requirement);
  const requirementId = await linkTo.inputValue();
  const uploaded = source.waitForResponse(response => new URL(response.url()).pathname === '/api/feasibility/evidence' &&
    response.request().method() === 'POST');
  await source.getByLabel('Attach file', { exact: true }).setInputFiles({ name: filename, mimeType: 'image/png', buffer: png });
  const upload = await uploaded;
  assert.equal(upload.status(), 201, await upload.text());
  assert.equal((await upload.json()).requirementId, requirementId);
  await source.getByRole('row').filter({ hasText: filename }).getByText(requirement, { exact: true }).waitFor();

  await button('Report and export').click();
  await missingReference.waitFor();
  await source.reload();
  await button(names.en.legal).click();
  await button(names.en.evidence).click();
  const href = await source.getByRole('link', { name: filename, exact: true }).getAttribute('href');
  assert.ok(href);
  const download = new URL(href, appUrl).href;
  const document = await source.request.get(download);
  assert.equal(document.status(), 200);
  assert.deepEqual(await document.body(), png);
  assert.equal((await receiver.request.get(download)).status(), 404);

  await button('Back to section').click();
  const savedEditor = row(requirement);
  await savedEditor.locator('summary').click();
  await savedEditor.getByLabel('Evidence reference', { exact: true }).fill('QA-WATER-2026-01');
  await saveStudy();
  await button('Report and export').click();
  await report.waitFor();
  assert.equal(await missingReference.count(), 0);
  console.log('PASS licence attachment, persistence, organization isolation and independent evidence reference in the report');

  for (const locale of ['en', 'ar']) {
    const labels = names[locale];
    for (const width of [1440, 390]) {
      await source.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await source.goto(portfolio(locale));
      await button(labels.legal).click();
      await capture('10', 'licensing', labels.register);
      await button(labels.evidence).click();
      await source.getByRole('region', { name: labels.attachments, exact: true }).getByRole('link', { name: filename, exact: true }).waitFor();
      await capture('22', 'licensing-evidence', labels.documents);

      async function capture(screen, name, label) {
        const register = source.getByRole('region', { name: label, exact: true });
        await register.getByRole('rowheader', { name: requirement, exact: true }).waitFor();
        await source.evaluate(() => document.fonts.ready.then(() => window.scrollTo(0, 0)));
        const layout = await register.evaluate(element => ({
          direction: getComputedStyle(element).direction,
          viewport: document.documentElement.clientWidth,
          page: document.documentElement.scrollWidth,
          register: element.clientWidth,
          table: element.scrollWidth,
          columns: getComputedStyle(document.querySelector('.fs-royal-licensing .fs-kpis')).gridTemplateColumns.split(' ').length,
        }));
        assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr');
        assert.ok(layout.page <= layout.viewport + 1, JSON.stringify(layout));
        assert.equal(layout.columns, width === 390 ? 2 : 4);
        if (width === 390) assert.ok(layout.table > layout.register, JSON.stringify(layout));
        await source.screenshot({ path: 'tests/subscriptions/screenshots/royal-' + screen + '-' + name + '-' + locale + '-' + width + '.png', fullPage: true, animations: 'disabled' });
      }
    }
  }
  console.log('PASS Royal licensing screens 10 and 22 in Arabic and English at 1440px and 390px');
}
