import {expect,it} from 'vitest';
import {partyMutationSchema,personalPartySourceSchema} from './debt-party-directory';
import {personalPayableCommandSchema} from './personal-payables';
import {personalFinancingSchema} from './personal-financing';
import {openingFinancialAccountSchema} from './financial-register';
const id='11111111-1111-4111-8111-111111111111';
it('rejects cross-scope mutations, reassignment fields and invalid email',()=>{
 const p={scope:'PERSONAL',action:'SAVE',name:'جهة',party_type:'BOTH'};
 expect(partyMutationSchema.safeParse(p).success).toBe(true);
 for(const extra of [{organization_id:id},{email:'invalid'},{user_id:id},{name:' '},{active:'false'}])expect(partyMutationSchema.safeParse({...p,...extra}).success).toBe(false);
 expect(partyMutationSchema.safeParse({scope:'ORGANIZATION',action:'DELETE',id}).success).toBe(false);
});
it('supports directory identities without accepting arbitrary source identifiers',()=>{
 expect(personalPartySourceSchema.safeParse(id).success).toBe(true);expect(personalPartySourceSchema.safeParse('party:'+id).success).toBe(true);
 expect(personalPartySourceSchema.safeParse('party:other-user-name').success).toBe(false);
});
it('routes all three personal financial entry schemas through a stable directory identity',()=>{
 const common={request_id:id,source_debt_id:'party:'+id,party:'جهة',description:'رصيد سابق',amount:10,date:'2026-10-21',due_date:null,reference:'QA'};
 expect(personalPayableCommandSchema.safeParse({...common,action:'CREATE'}).success).toBe(true);
 expect(personalFinancingSchema.safeParse({...common,action:'FUND',kind:'LOAN',side:'RECEIVABLE',account_id:id}).success).toBe(true);
 expect(openingFinancialAccountSchema.safeParse({request_id:id,source_debt_id:'party:'+id,scope:'PERSONAL',type:'RECEIVABLE',name:'جهة',currency:'SAR',opening_balance:10,opening_date:'2026-10-21',fx_rate:1}).success).toBe(true);
});
