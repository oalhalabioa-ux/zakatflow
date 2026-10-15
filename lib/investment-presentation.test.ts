import {expect,it} from 'vitest';
import {investmentInstrumentDetails,investmentInstrumentReport,investmentOperationLabel,investmentPresentation} from './investment-presentation';
import {investmentTermsSchema,investmentProjection} from './investments';
const t=investmentTermsSchema.parse({name:'Test',instrument:'DEPOSIT',ownership_scope:'PERSONAL',party_name:'Bank',currency:'SAR',principal:100000,face_value:100000,fees:200,annual_rate:5,start_date:'2027-01-01',maturity_date:'2028-01-01',interest_basis:'ACT_365',zakat_basis:'HIJRI_354',zakat_rate:0,zakat_base:100000,zakat_treatment:'INVESTOR',inflation_rate:0,fx_rate:1,funding_account_id:'10000000-0000-4000-8000-000000000001'});
it('separates deposit principal from bond nominal value and discount in details and exports',()=>{
 const deposit=investmentInstrumentReport([{id:'d',status:'ACTIVE',terms:t}],[],'DEPOSIT');
 const bond={...t,instrument:'BOND' as const,principal:98000};const report=investmentInstrumentReport([{id:'b',status:'ACTIVE',terms:bond},{id:'d',status:'ACTIVE',terms:t}],[],'BOND');
 expect(deposit.columns).not.toContain('فرق الاسترداد قبل الرسوم');expect(report.rows).toHaveLength(1);
 expect(report.rows[0][report.columns.indexOf('فرق الاسترداد قبل الرسوم')]).toBe(2000);
 expect(report.rows[0][report.columns.indexOf(investmentPresentation.BOND.income)]).toBe(5000);
 expect(report.rows[0][report.columns.indexOf('صافي العائد التقديري')]).toBe(6800);
 expect(investmentInstrumentDetails(bond)).toContainEqual(['إجمالي التكلفة المدفوعة',98200]);
});
it('distinguishes sukuk profit from coupons and exports only posted cash receipts',()=>{
 const sukuk={...t,instrument:'SUKUK' as const};const ops=[{contract_id:'s',kind:'INCOME',status:'POSTED',amount:900,withheld_zakat:100,operation_date:'2027-04-01'},{contract_id:'s',kind:'INCOME',status:'APPROVED',amount:9999,withheld_zakat:0,operation_date:'2027-07-01'},{contract_id:'other',kind:'INCOME',status:'POSTED',amount:999,withheld_zakat:0,operation_date:'2027-07-01'}];const r=investmentInstrumentReport([{id:'s',status:'ACTIVE',terms:sukuk}],ops,'SUKUK');
 expect(r.columns).toContain('أرباح الصك المتوقعة للفترة');expect(r.columns).not.toContain('الكوبون المتوقع للفترة');expect(r.rows[0][r.columns.indexOf('المقبوض النقدي من العائد')]).toBe(900);expect(r.csvRows[0][r.csvColumns.indexOf('الزكاة المخصومة فعليًا من العائد')]).toBe(100);
 expect(investmentOperationLabel('DEPOSIT','FUND')).toBe('تحويل إلى الوديعة');expect(investmentOperationLabel('BOND','FUND')).toBe('شراء السند');expect(investmentOperationLabel('SUKUK','INCOME')).toBe('قبض أرباح الصك');
});
it('preserves Hijri zakat and early redemption coverage in deposit exports',()=>{
 const terms={...t,zakat_rate:2.5,maturity_date:'2027-04-01',zakat_treatment:'COVERED' as const,zakat_assessment_mode:'INSTITUTION_COVERED' as const,zakat_coverage_from:'2027-01-01',zakat_coverage_to:'2027-04-01',zakat_coverage_reference:'Contract'};
 const p=investmentProjection(terms);expect(p.days).toBe(90);expect(p.zakat).toBe(635.5932);
 const r=investmentInstrumentReport([{id:'d',status:'CLOSED',terms}],[{contract_id:'d',kind:'REDEEM',status:'POSTED',amount:100000,withheld_zakat:0,operation_date:'2027-03-01'}],'DEPOSIT');expect(r.zakatRows[0][2]).toBe(635.5932);expect(r.coverageRows[0]).toEqual(['Test','2027-01-01','2027-03-01','Contract']);expect(r.csvColumns.length).toBe(r.csvRows[0].length);
});
it('reports bond premium losses and zero coupons separately from the income rate',()=>{
 for(const [principal,rate,gain,coupon,net] of [[102000,5,-2000,5000,2800],[98000,0,2000,0,1800]]){
  const r=investmentInstrumentReport([{id:'b',status:'ACTIVE',terms:{...t,instrument:'BOND',principal,annual_rate:rate}}],[],'BOND');
  expect(r.rows[0][r.columns.indexOf('فرق الاسترداد قبل الرسوم')]).toBe(gain);expect(r.rows[0][r.columns.indexOf(investmentPresentation.BOND.income)]).toBe(coupon);expect(r.rows[0][r.columns.indexOf('صافي العائد التقديري')]).toBe(net);
 }
});
