import React from 'react';
import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
vi.mock('./DisplayCurrency',()=>({CurrencyScope:()=>null,Money:()=>null,useDisplayCurrencyCode:()=> 'SAR'}));
import FinancialRegisterWorkspace,{PayableRows} from './FinancialRegisterWorkspace';
import type {DebtItem} from '../lib/financial-register';

function navigationLinks(html:string){
 const start=html.indexOf('<nav class="finance-module-nav');
 const end=html.indexOf('</nav>',start);
 const nav=start>=0&&end>=0?html.slice(start,end):'';
 return nav.split('<a').slice(1).map(markup=>{
  const anchor=markup.split('>')[0];
  const href=anchor.split('href="')[1]?.split('"')[0]??'';
  const url=new URL(href,'https://zakatflow.test');
  return {path:url.pathname.split('/').slice(2).join('/'),scope:url.searchParams.get('scope'),active:anchor.includes('aria-current="page"')};
 });
}

it('shows unified workspace links only on debt pages with exactly one active page',()=>{
 for(const [view,side,current] of [['debts','RECEIVABLE','receivables'],['debts','PAYABLE','payables'],['debt-report','RECEIVABLE','debt-report']] as const){
  const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view} initialScope="ORGANIZATION" initialDebtSide={side}/>);
  const links=navigationLinks(html);
  expect(links.map(link=>link.path)).toEqual(['debts','receivables','payables','loans','employee-advances','debt-advances','debt-collection','debt-report']);
  expect(links.every(link=>link.scope==='ORGANIZATION')).toBe(true);
  expect(links.filter(link=>link.active).map(link=>link.path)).toEqual([current]);
 }
 for(const view of ['cash','position'] as const)expect(renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view={view}/>)).not.toContain('finance-module-nav');
});

it('preserves personal scope between all debt pages and exposes personal payable entry',()=>{
 const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view="debts" initialScope="PERSONAL" initialDebtSide="PAYABLE"/>);
 const links=navigationLinks(html);
 expect(links.filter(link=>link.scope==='PERSONAL').map(link=>link.path)).toEqual(['debts','receivables','payables','loans','debt-advances','debt-collection','debt-report']);
 expect(html).toContain('إثبات التزام شخصي قائم');
 expect(html).not.toContain('>النطاق<select');
});
it('offers categories only for the selected scope and debt side while keeping source and maturity separate',()=>{const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view="debts" initialScope="PERSONAL" initialDebtSide="PAYABLE"/>);expect(html).toContain('value="P_AP_LOAN"');expect(html).not.toContain('value="P_AR_RENT"');expect(html).toContain('حسب الفئة والاستحقاق');expect(html).toContain('جميع المصادر');expect(html).toContain('غير متداول');});

it('renders personal and institutional payable identities in independent table cells',()=>{
 const row:DebtItem={id:'debt-1',partyKey:'party-1',partyName:'جهة تجريبية',organizationId:null,entityId:null,side:'PAYABLE',currency:'SAR',amount:500,totalBase:500,appliedBase:0,dueDate:null,date:'2026-10-28',description:'بيان العملية',source:'PERSONAL_PAYABLE',eventId:null,voucherType:'قرض دائن',voucherNumber:'LR-0001-26',rawReference:'BANK-42'};
 for(const personal of [true,false]){
  const html=renderToStaticMarkup(<PayableRows locale="ar" rows={[row]} asOf="2026-10-28" personal={personal} onOpen={()=>{}} onCategory={()=>{}}/>);
  const headers=[...html.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(m=>m[1]);
  const cells=[...html.split('<tbody>')[1].matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/g)].map(m=>m[1]);
  expect(headers.slice(0,4)).toEqual(['الجهة','نوع السند','رقم السند','المرجع الخارجي']);
  expect(cells).toHaveLength(headers.length);
  expect(cells[0]).toContain('جهة تجريبية');expect(cells[0]).not.toContain('LR-0001-26');
  expect(cells[1]).toBe('قرض دائن');expect(cells[2]).toContain('LR-0001-26');expect(cells[3]).toContain('BANK-42');
 }
});
it('offers a dedicated voucher type filter and number search in the debt register',()=>{
 const html=renderToStaticMarkup(<FinancialRegisterWorkspace locale="ar" view="debts" initialScope="PERSONAL" initialDebtSide="PAYABLE"/>);
 expect(html).toContain('<label>نوع السند<select');expect(html).toContain('جميع أنواع السندات');expect(html).toContain('نوع السند، رقمه أو المرجع');
});
