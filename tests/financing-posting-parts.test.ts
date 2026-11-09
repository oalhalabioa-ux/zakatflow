import {it,expect} from 'vitest';
import {financingPostingLines,type FinancingPostingPart} from '../lib/financing-posting-parts';
const parts:FinancingPostingPart[]=[{role:'FINANCE_PRINCIPAL_PAYMENT',obligationId:'principal',amount:40,baseAmount:150},{role:'FINANCE_CHARGE_PAYMENT',obligationId:'charge',amount:20,baseAmount:75}];
const build=(p=parts,total=60,base=225)=>financingPostingLines(p,'class','USD',3.75,total,base,'Installment','OUTFLOW');
it('preserves both obligation amounts, FX and source roles rather than one aggregate line',()=>{
 const lines=build();expect(lines).toHaveLength(2);expect(lines.map(l=>[l.metadata.source_role,l.metadata.settlement_obligation_id,l.amount,l.base_amount])).toEqual([['FINANCE_PRINCIPAL_PAYMENT','principal',40,150],['FINANCE_CHARGE_PAYMENT','charge',20,75]]);
 expect(lines.reduce((n,l)=>n+l.base_amount,0)).toBe(225);
});
it('supports principal-only and finance-only partial installments',()=>{expect(build([parts[0]],40,150)).toHaveLength(1);expect(build([parts[1]],20,75)[0].metadata.source_role).toBe('FINANCE_CHARGE_PAYMENT');});
it('rejects duplicate roles or obligations, missing parts, sum and FX discrepancies',()=>{
 for(const p of [[],[parts[0],parts[0]],[parts[0],{...parts[1],obligationId:'principal'}],[parts[0],{...parts[1],baseAmount:74}],[parts[0],{...parts[1],amount:0}],[parts[0],{...parts[1],amount:NaN}]])expect(()=>build(p)).toThrow('FINANCE_SETTLEMENT_PARTS_INVALID');
 expect(()=>build(parts,61)).toThrow();expect(()=>build(parts,60,224)).toThrow();
});
