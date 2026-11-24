import assert from 'node:assert/strict';
import { createServerClient } from '@supabase/ssr';

export async function verifyFeasibilitySharingBrowser({ browser, appUrl, url, anonKey, owner, recipient, sourceOrg, recipientOrg }) {
  assert.equal(url, 'http://127.0.0.1:54321');
  assert.equal(appUrl, 'http://localhost:3002');
  const contexts = [];
  try {
    async function pageFor(account) {
      const cookies = new Map();
      const supabase = createServerClient(url, anonKey, { cookies: {
        getAll: () => [...cookies.values()],
        setAll: items => { for (const item of items) cookies.set(item.name, item); },
      } });
      assert.ifError((await supabase.auth.signInWithPassword({ email: account.email, password: account.password })).error);
      const context = await browser.newContext();
      contexts.push(context);
      await context.addCookies([...cookies.values()].map(({ name, value }) => ({ name, value, url: appUrl })));
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.setDefaultNavigationTimeout(16000);
      return page;
    }

    const admin = await pageFor(owner);
    const receiver = await pageFor(recipient);
    async function submitProposal() {
      await receiver.getByLabel('Study title · Reason for the change or addition', { exact: true })
        .fill('Synthetic study title correction.');
      await receiver.getByRole('button', { name: 'Send changes for review' }).click();
      const success = receiver.getByText('The changes were sent to the study owner.', { exact: true });
      const failure = receiver.getByText('The changes could not be sent. Check the current request status.', { exact: true });
      await success.or(failure).first().waitFor();
      assert.equal(await success.isVisible(), true, 'The study change request must be submitted successfully');
    }
    const setting = admin.getByLabel('Permissions available to owners');
    const signalled = admin.getByText('Sharing setting saved.', { exact: true });
    const setMode = async mode => {
      await setting.selectOption(mode);
      await admin.getByRole('button', { name: 'Save sharing setting' }).click();
      await signalled.waitFor();
      await admin.reload();
      assert.equal(await setting.inputValue(), mode);
    };
    await admin.goto(appUrl + '/admin/settings?lang=en');
    await setting.waitFor();
    assert.equal(await setting.inputValue(), 'read');
    const denied = await receiver.request.patch(appUrl + '/api/admin/settings/feasibility-sharing', {
      headers: { Origin: appUrl }, data: { mode: 'edit' }, timeout: 12000,
    });
    assert.equal(denied.status(), 403);
    await setMode('edit');

    const source = await pageFor(owner);
    const title = 'Synthetic QA permissions study';
    await source.goto(appUrl + '/en/feasibility?' + new URLSearchParams({ scope: 'ORGANIZATION', organization: sourceOrg }));
    await source.getByRole('button',{name:'New study',exact:true}).click();
    await source.getByRole('textbox', { name: 'New project name', exact: true }).fill(title);
    await source.getByRole('button', { name: 'Add project +', exact: true }).click();
    await source.getByRole('heading', { name: title, exact: true }).waitFor();
    await source.getByRole('button', { name: 'Collaboration', exact: true }).click();
    await source.getByLabel('Receiving organization ID').fill(recipientOrg);
    await source.getByLabel('Recipient permission').selectOption('edit');
    await source.getByRole('button', { name: 'Share revision' }).click();
    await source.getByRole('button', { name: 'Revoke access' }).waitFor();

    await receiver.goto(appUrl + '/en/feasibility/shared?organization=' + sourceOrg);
    await receiver.getByRole('alert').filter({ hasText: 'The selected organization is unavailable.' }).waitFor();
    assert.equal(await receiver.getByText('Your organization ID for sharing', { exact: false }).count(), 0);
    assert.equal(await receiver.getByRole('link', { name: title, exact: true }).count(), 0);

    await receiver.goto(appUrl + '/en/feasibility/shared?organization=' + recipientOrg);
    await receiver.getByRole('link', { name: title, exact: true }).click();
    await receiver.getByRole('button', { name: 'Edit shared copy' }).click();
    await receiver.getByLabel('Shared copy title').fill('Synthetic QA reviewed copy');
    await receiver.getByRole('button', { name: 'Save copy edits' }).click();
    await receiver.getByText('Shared copy edits saved.', { exact: true }).waitFor();
    await receiver.getByRole('heading', { name: 'Synthetic QA reviewed copy', exact: true }).waitFor();
    await source.reload();
    await source.getByRole('heading', { name: title, exact: true }).waitFor();

    console.log('CHECK feasibility recipient submits changes through Chromium');
    await submitProposal();
    await source.goto(appUrl + '/en/notifications');
    await source.getByRole('link', { name: 'Review changes', exact: true }).click();
    await source.getByRole('table').getByRole('row').filter({ hasText: 'Synthetic QA reviewed copy' }).waitFor();
    await source.getByLabel('Resolve field Study title', { exact: true }).selectOption('proposed');
    await source.getByLabel('Decision reason for Study title', { exact: true }).fill('The proposed title is accurate.');
    await source.getByRole('button', { name: 'Save item decisions', exact: true }).click();
    await source.getByText('Approved', { exact: true }).waitFor();
    await receiver.reload();
    await receiver.getByText('Latest request · Approved', { exact: true }).waitFor();

    console.log('PASS owner notification, field comparison, approval and recipient status');
    await receiver.getByRole('button', { name: 'Edit shared copy' }).click();
    await receiver.getByLabel('Shared copy title').fill('Synthetic QA declined draft');
    await receiver.getByRole('button', { name: 'Save copy edits' }).click();
    await receiver.getByRole('heading', { name: 'Synthetic QA declined draft', exact: true }).waitFor();
    await submitProposal();
    await source.goto(appUrl + '/en/notifications');
    await source.getByRole('link', { name: 'Review changes', exact: true }).first().click();
    await source.getByLabel('Resolve field Study title', { exact: true }).selectOption('current');
    await source.getByLabel('Decision reason for Study title', { exact: true }).fill('Keep the accepted name');
    await source.getByRole('button', { name: 'Save item decisions', exact: true }).click();
    await source.getByRole('status').filter({ hasText: /^Declined$/ }).waitFor();
    await receiver.reload();
    await receiver.getByText('Latest request · Declined', { exact: true }).waitFor();
    await receiver.getByText('Study title · Declined · Keep the accepted name', { exact: true }).waitFor();

    console.log('PASS decline with a reason and recipient status');
    const project = new URL(source.url()).searchParams.get('project');
    assert.ok(project);
    const auditQuery = appUrl + '/api/feasibility/organization-shares?' +
      new URLSearchParams({ action: 'audit', organization: sourceOrg, project });
    const hiddenAudit = await receiver.request.get(auditQuery);
    assert.equal(hiddenAudit.status(),403);
    await source.goto(appUrl + '/en/feasibility?' + new URLSearchParams({ scope: 'ORGANIZATION', organization: sourceOrg }));
    await source.getByRole('button', { name: 'Collaboration', exact: true }).click();
    await source.getByRole('button', { name: 'Permissions and audit', exact: true }).click();
    const activity = source.locator('.fs-royal-share-audit');
    await activity.getByRole('rowheader', { name: 'Change request approved', exact: true }).waitFor();
    await activity.getByRole('rowheader', { name: 'Change request declined', exact: true }).waitFor();
    console.log('PASS source owner can see dated audit, recipient cannot read it');

    await setMode('read');
    await receiver.reload();
    await receiver.getByRole('heading', { name: 'Synthetic QA declined draft', exact: true }).waitFor();
    assert.equal(await receiver.getByRole('button', { name: 'Edit shared copy' }).count(), 0);
    await setMode('disabled');
    await receiver.reload();
    await receiver.getByText('The study is unavailable or access ended.', { exact: true }).waitFor();
    await setMode('read');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}
