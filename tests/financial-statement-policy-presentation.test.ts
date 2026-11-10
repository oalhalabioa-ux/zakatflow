import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const statements=readFileSync('components/financial-reports/FinancialStatementSource.tsx','utf8');
const opening=readFileSync('components/financial-reports/DraftOpeningStatementPreview.tsx','utf8');

describe('financial statements presentation guardrails',()=>{
 it('preserves the specific missing posting-policy code and links to the existing approval workspace',()=>{
  expect(statements).toContain("body.error==='REPORTING_APPROVED_POLICY_REQUIRED'");
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
 it('offers the three cumulative reporting scopes without exposing group figures or changing global navigation',()=>{
  expect(statements).toContain('<option value="COMPANY_DIRECT">');
  expect(statements).toContain('<option value="COMPANY_WITH_BRANCHES">');
  expect(statements).toContain('<option value="GROUP_WITH_SUBSIDIARIES">');
  expect(statements).toContain("const scopeReady=reportScope==='COMPANY_WITH_BRANCHES'");
  expect(statements).toContain("group={reportScope==='GROUP_WITH_SUBSIDIARIES'}");
  expect(statements).toContain("onGroupChange={withSubsidiaries=>");
  expect(statements).toContain('disabled={!ready||displayDraft||exporting}');
  expect(statements).toContain('لا نعيد تخصيص القيود تلقائيًا');
  expect(statements).toContain('Branch — filter pending integration');
  expect(statements).toContain('Cost center — filter pending integration');
 });
});
