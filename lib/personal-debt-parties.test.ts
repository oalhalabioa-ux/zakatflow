import {it,expect} from 'vitest';
import {applyPersonalDebtLinks,personalDebtParties,personalPartyDebts} from './personal-debt-parties';
import type {RegisterData,DebtItem} from './financial-register';
const debt=(id:string,partyKey=id,side='RECEIVABLE',date='2026-10-01')=>({id,partyKey,partyName:'اسم متشابه',side,amount:100,currency:'SAR',date,dueDate:date} as DebtItem);
const data=(debts:DebtItem[])=>({debts,debtMovements:[{debtId:'added',side:'SALES',partyKey:'added'}]} as RegisterData);
it('does not merge equal names without an explicit link',()=>expect(personalDebtParties(data([debt('one'),debt('two')]),'RECEIVABLE')).toHaveLength(2));
it('links an additional voucher to the original party in balances and statements',()=>{const r=applyPersonalDebtLinks(data([debt('old'),debt('added')]),[{record_id:'added',side:'RECEIVABLE',party_key:'old',party_name:'الجهة الأصلية'}]);expect(r.debts[1].partyKey).toBe('old');expect(r.debtMovements[0].partyKey).toBe('old');expect(personalDebtParties(r,'RECEIVABLE')).toHaveLength(1)});
it('keeps receivables and payables separate and sorts eligible settlement vouchers oldest first',()=>{const old=debt('old','root','RECEIVABLE','2026-09-01'),fresh=debt('fresh','root');expect(personalPartyDebts(data([fresh,debt('pay','root','PAYABLE'),old]),fresh).map(d=>d.id)).toEqual(['old','fresh'])});
