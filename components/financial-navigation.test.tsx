import React from 'react';
import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
vi.mock('./DisplayCurrency',()=>({CurrencyScope:()=>null,Money:()=>null,useDisplayCurrencyCode:()=> 'SAR'}));
import FinancialRegisterWorkspace from './FinancialRegisterWorkspace';
it('shows unified workspace links only on debt pages with exactly one active page',()=>{
 for(const [view,side,current] of [['debts','RECEIVABLE','receivables'],['debts','PAYABLE','payables'],['debt-report','RECEIVABLE','debt-report']] as const){
 const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view} initialScope="ORGANIZATION" initialDebtSide={side}/>),nav=html.match(/<nav class="finance-module-nav[^"]*"[^>]*>(.*?)<\/nav>/)?.[1]??'';
 expect([...nav.matchAll(/href="\/ar\/([^?]+)\?scope=ORGANIZATION"/g)].map(m=>m[1])).toEqual(['debts','receivables','payables','loans','employee-advances','debt-advances','debt-collection','debt-report']);
 expect((nav.match(/aria-current="page"/g)??[])).toHaveLength(1);
 expect(nav).toContain('aria-current="page" href="/ar/'+current+'?scope=ORGANIZATION"');
 }
 for(const view of ['cash','position'] as const)expect(renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view}/>)).not.toContain('finance-module-nav');
});

it('preserves personal scope between all debt pages and exposes personal payable entry',()=>{
 const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view="debts" initialScope="PERSONAL" initialDebtSide="PAYABLE"/>);
 expect(html).toContain('/ar/payables?scope=PERSONAL');expect(html).toContain('/ar/receivables?scope=PERSONAL');expect(html).toContain('إثبات التزام شخصي قائم');expect(html).not.toContain('>النطاق<select');
});
it('offers categories only for the selected scope and debt side while keeping source and maturity separate',()=>{const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view="debts" initialScope="PERSONAL" initialDebtSide="PAYABLE"/>);expect(html).toContain('value="P_AP_LOAN"');expect(html).not.toContain('value="P_AR_RENT"');expect(html).toContain('حسب الفئة والاستحقاق');expect(html).toContain('جميع المصادر');expect(html).toContain('غير متداول');});
