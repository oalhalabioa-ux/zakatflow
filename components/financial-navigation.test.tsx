import React from 'react';
import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
vi.mock('./DisplayCurrency',()=>({CurrencyScope:()=>null,Money:()=>null,useDisplayCurrencyCode:()=> 'SAR'}));
import FinancialRegisterWorkspace from './FinancialRegisterWorkspace';
it('shows three debt links only on debt pages with exactly one active page',()=>{
 for(const [view,side,current] of [['debts','RECEIVABLE','receivables'],['debts','PAYABLE','payables'],['debt-report','RECEIVABLE','debt-report']] as const){
 const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view} initialScope="ORGANIZATION" initialDebtSide={side}/>),nav=html.match(/<nav class="finance-module-nav"[^>]*>(.*?)<\/nav>/)?.[1]??'';
 expect([...nav.matchAll(/href="\/ar\/([^?]+)\?scope=ORGANIZATION"/g)].map(m=>m[1])).toEqual(['receivables','payables','debt-report']);
 expect((nav.match(/aria-current="page"/g)??[])).toHaveLength(1);
 expect(nav).toContain('aria-current="page" href="/ar/'+current+'?scope=ORGANIZATION"');
 }
 for(const view of ['cash','position'] as const)expect(renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view}/>)).not.toContain('finance-module-nav');
});

it('preserves personal scope between all debt pages and exposes personal payable entry',()=>{
 const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view="debts" initialScope="PERSONAL" initialDebtSide="PAYABLE"/>);
 expect(html).toContain('/ar/payables?scope=PERSONAL');expect(html).toContain('/ar/receivables?scope=PERSONAL');expect(html).toContain('إضافة التزام شخصي');expect(html).toContain('value="PERSONAL" selected=""');
});
