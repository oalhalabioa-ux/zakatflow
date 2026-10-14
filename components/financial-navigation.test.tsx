import React from 'react';
import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
vi.mock('./DisplayCurrency',()=>({CurrencyScope:()=>null,Money:()=>null,useDisplayCurrencyCode:()=> 'SAR'}));
import FinancialRegisterWorkspace from './FinancialRegisterWorkspace';
it('keeps cash, receivables, payables and position navigation stable with exactly one current page',()=>{for(const [view,side,current] of [['cash','RECEIVABLE','cash-and-banks'],['debts','RECEIVABLE','receivables'],['debts','PAYABLE','payables'],['position','RECEIVABLE','financial-position']] as const){const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view} initialScope="ORGANIZATION" initialDebtSide={side}/>),nav=html.match(/<nav class="finance-module-nav"[^>]*>(.*?)<\/nav>/)?.[1]??'';const routes=[...nav.matchAll(/href="\/ar\/([^?]+)\?scope=ORGANIZATION"/g)].map(m=>m[1]);expect(routes).toEqual(['cash-and-banks','receivables','payables','financial-position']);expect((nav.match(/aria-current="page"/g)??[])).toHaveLength(1);expect(nav).toMatch(new RegExp('href="/ar/'+current+'\\?scope=ORGANIZATION" aria-current="page"|aria-current="page" href="/ar/'+current+'\\?scope=ORGANIZATION"'));}});
