import {it,expect} from 'vitest';
import {eliminateDividendCashPayments,verifyOrdinaryDividend} from '../lib/financial-group-ordinary-dividend';

function fixture(){
 const journal=(id:string,organizationId:string,dr:string,cr:string,amount:string)=>({
  id,organizationId,date:'2026-02-01',currency:'SAR',status:'POSTED' as const,
  lines:[{accountId:dr,debit:amount,credit:'0'},{accountId:cr,debit:'0',credit:amount}],
 });
 const account=(id:string,kind:'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE',organizationId:string,reportingCode:string)=>({
  id,kind,organizationId,reportingCode,currency:'SAR',
 });
 return {
  parent:{accounts:[account('110098','ASSET','parent','1100'),account('410061','REVENUE','parent','4100')],
   opening:[],journals:[journal('parent-event','parent','110098','410061','80')]},
  child:{accounts:[account('330098','EQUITY','child','3300'),account('210098','LIABILITY','child','2100')],
   opening:[],journals:[journal('child-event','child','330098','210098','100')]},
 };
}

it('separates the intra-group and minority shares of an unpaid paired distribution',()=>{
 const {parent,child}=fixture();
 expect(verifyOrdinaryDividend(parent,child,{parentEventId:'parent-event',subsidiaryEventId:'child-event'},'2026-01-01','2026-03-31','20'))
  .toMatchObject({ordinaryDividends:'100.0000',parentDividend:'80.0000',nciDividend:'20.0000'});
});
it('rejects an incorrect ownership share or a subsequent allocation to the payable',()=>{
 const {parent,child}=fixture(),ref={parentEventId:'parent-event',subsidiaryEventId:'child-event'};
 expect(verifyOrdinaryDividend(parent,child,ref,'2026-01-01','2026-03-31','30')).toBeNull();
 child.journals.push({...child.journals[0],id:'settlement'});
 expect(verifyOrdinaryDividend(parent,child,ref,'2026-01-01','2026-03-31','20')).toBeNull();
});

function paidFixture(parentAmount:string,minorityAmount:string){
 const {parent,child}=fixture();
 parent.accounts.push({...parent.accounts[0],id:'100001',reportingCode:'1000',cash:true} as typeof parent.accounts[number]);
 child.accounts.push({...child.accounts[0],id:'100002',reportingCode:'1000',kind:'ASSET',cash:true} as typeof child.accounts[number]);
 parent.journals.push({...parent.journals[0],id:'receipt',date:'2026-02-02',lines:[
  {accountId:'100001',debit:parentAmount,credit:'0',cashActivity:'INVESTING'},
  {accountId:'110098',debit:'0',credit:parentAmount},
 ]} as typeof parent.journals[number]);
 for(const [id,amount] of [['parent-payment',parentAmount],['minority-payment',minorityAmount]]){
  child.journals.push({...child.journals[0],id,date:'2026-02-02',lines:[
   {accountId:'210098',debit:amount,credit:'0'},
   {accountId:'100002',debit:'0',credit:amount,cashActivity:'FINANCING'},
  ]} as typeof child.journals[number]);
 }
 return {parent,child,ref:{parentEventId:'parent-event',subsidiaryEventId:'child-event',
  parentPayment:{parentEventId:'receipt',subsidiaryEventId:'parent-payment'},
  minorityPayment:{subsidiaryEventId:'minority-payment'}}};
}

it('matches total and partial receipts by party and preserves source cash classifications',()=>{
 for(const [paid,minority,parentOutstanding,minorityOutstanding] of [['50','10','30.0000','10.0000'],['80','20','0.0000','0.0000']]){
  const {parent,child,ref}=paidFixture(paid,minority);
  expect(verifyOrdinaryDividend(parent,child,ref,'2026-01-01','2026-03-31','20')).toMatchObject({
   parentOutstanding,minorityOutstanding,minorityCashPaid:Number(minority).toFixed(4),
   internalCash:{amount:Number(paid).toFixed(4),receiptActivity:'INVESTING',paymentActivity:'FINANCING'},
  });
 }
});
it('rejects overpayment, repeated references and unpaired amounts',()=>{
 for(const [paid,minority] of [['81','20'],['80','21']]){
  const {parent,child,ref}=paidFixture(paid,minority);
  expect(verifyOrdinaryDividend(parent,child,ref,'2026-01-01','2026-03-31','20')).toBeNull();
 }
 const {parent,child,ref}=paidFixture('20','10');
 expect(verifyOrdinaryDividend(parent,child,{...ref,minorityPayment:{subsidiaryEventId:'parent-payment'}},'2026-01-01','2026-03-31','20')).toBeNull();
 parent.journals[1].lines.forEach(line=>{if(line.debit==='20')line.debit='19';if(line.credit==='20')line.credit='19';});
 expect(verifyOrdinaryDividend(parent,child,ref,'2026-01-01','2026-03-31','20')).toBeNull();
});

it('removes the two internal cash legs while retaining minority cash payments and closing cash',()=>{
 const {parent,child,ref}=paidFixture('50','10');
 const matched=verifyOrdinaryDividend(parent,child,ref,'2026-01-01','2026-03-31','20')!;
 const rows=[['opening','500'],['operating','0'],['investing','50'],['financing','-60'],['movement','-10'],['closing','490']]
  .map(([key,after])=>({key,after}));
 expect(eliminateDividendCashPayments(rows,[matched.internalCash!]).map(row=>[row.key,row.adjustment,row.after])).toEqual([
  ['opening','0.0000','500.0000'],['operating','0.0000','0.0000'],['investing','-50.0000','0.0000'],
  ['financing','50.0000','-10.0000'],['movement','0.0000','-10.0000'],['closing','0.0000','490.0000'],
 ]);
});
