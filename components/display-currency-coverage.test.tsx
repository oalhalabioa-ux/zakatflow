import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/ar/vat'}));
import {DisplayCurrencyProvider,Money} from './DisplayCurrency';
import {VatManagementDashboard,VatPeriodSummaryForm} from './vat-period-workspace';
import {emptyVatPeriodSummary} from '../lib/vat-period-summary';
const totals={salesBase:'3750',salesGross:'4312.5',purchaseBase:'750',purchaseVatBeforeRecovery:'112.5',outputTax:'562.5',inputTax:'112.5',taxPayable:'450',taxCredit:'0',salesNet:'3750',purchaseNet:'750',paidAmount:'45',cashReservedAmount:'100',zeroRatedSales:'0',exemptSales:'0',outOfScopeSales:'0'};
const props={organizationId:'test',period:{from:'2026-10-01',to:'2026-10-31'},yearStart:'2026-01-01',frequency:'MONTHLY' as const,periodSummary:null,periodTotals:totals,annualTotals:totals,standardRate:15,registered:true,ar:true,onSaved:()=>{}};
const render=(child:React.ReactNode,mode:'PRIMARY'|'USD'='USD')=>renderToStaticMarkup(<DisplayCurrencyProvider locale="ar" initialMode={mode}>{child}</DisplayCurrencyProvider>);
describe('cross-module currency presentation',()=>{
 it('converts the VAT dashboard, annual cards, monetary charts and obligations',()=>{const html=render(<VatManagementDashboard {...props} monthlyTrend={[{month:'2026-10',outputTax:'562.5',inputTax:'112.5'}]} upcomingObligations={[{id:'1',organizationName:'A',dueDate:'2026-10-31',outstandingAmount:'375'}]}/>);expect(html).toContain('1,000.00 USD');expect(html).toContain('150.00 USD');expect(html).toContain('100.00 USD');expect(html).not.toContain('3,750.00 SAR');expect(html).toContain('width:10%');});
 it('restores the original VAT values in primary mode',()=>{expect(render(<VatManagementDashboard {...props}/>,'PRIMARY')).toContain('3,750.00 SAR');});
 it('converts period totals while preserving editable inputs and percentages',()=>{const html=render(<VatPeriodSummaryForm {...props} periodSummary={{...emptyVatPeriodSummary(),sales_standard_base:3750}}/>);expect(html).toContain('1,150.00 USD');expect(html).toContain('value="3750"');expect(html).toContain('value="100"');expect(html).not.toContain('value="1000"');});
 it('preserves original printed amounts, unknowns and unit-price precision',()=>{const html=render(<><Money value={375} preservePrint/><Money value={null}/><Money value={4.5} precision={6}/></>);expect(html).toContain('100.00 USD');expect(html).toContain('display-money-print');expect(html).toContain('375.00 SAR');expect(html).toContain('—');expect(html).toContain('1.20 USD');});
 it('does not label missing FX as dollars',()=>{expect(render(<Money value={500} currency="EGP"/>)).toContain('500.00 EGP');});
});
