import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const statements=readFileSync('components/financial-reports/FinancialStatementSource.tsx','utf8');
const opening=readFileSync('components/financial-reports/DraftOpeningStatementPreview.tsx','utf8');

describe('financial statements presentation guardrails',()=>{
 it('preserves the specific missing posting-policy code and links to the existing approval workspace',()=>{
  expect(statements).toContain("'REPORTING_APPROVED_POLICY_REQUIRED'");
  expect(statements).toContain('financial-reporting-policy?organization=');
  expect(statements).toContain('الأرصدة الافتتاحية المعتمدة محفوظة');
 });
 it('never substitutes bank-register balances for an unavailable position statement',()=>{
  expect(statements).not.toContain('AvailableRegisterBalances');
  expect(statements).toContain('لا تُعرض أرصدة النقد منفردة');
 });
 it('uses the previously approved position layout and table for an opening draft',()=>{
  expect(opening).toContain('fs-statement-layout fs-position-layout');
  expect(opening).toContain('fs-source-statement-table fs-position-table');
  expect(opening).toContain('className="fs-table"');
  expect(opening).not.toContain('ob-draft-table');
 });
 it('keeps scope controls only in the shared banner and blocks unsupported reporting',()=>{
  expect(statements).not.toContain("'مستوى التقرير','Report level'");
  expect(statements).not.toContain('className="fs-report-scope-filters"');
  const banner=statements.split('<TopbarOrganizationControls>')[1].split('</TopbarOrganizationControls>')[0];
  expect(banner).toContain('WorkspaceOrganizationPicker');
  expect(banner).toContain('value={branch}');
  expect(banner).toContain('Cost center — filter pending integration');
  expect(statements).toContain("const scopeReady=reportScope==='COMPANY_WITH_BRANCHES'");
  expect(statements).toContain("group={reportScope==='GROUP_WITH_SUBSIDIARIES'}");
  expect(statements).toContain("onGroupChange={withSubsidiaries=>");
  expect(statements).toContain('disabled={!ready||displayDraft||exporting}');
  expect(statements).toContain('لا نعيد تخصيص القيود تلقائيًا');
  expect(statements).toContain('REPORTING_BRANCH_OPENING_REQUIRED');
  expect(statements).toContain('Cost center — filter pending integration');
 });
});
