import {it,expect} from 'vitest';
import {verifyOrdinaryDividend} from '../lib/financial-group-ordinary-dividend';

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
