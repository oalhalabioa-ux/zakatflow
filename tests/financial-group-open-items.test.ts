import {expect,it} from 'vitest';
import {verifyGroupOpenItems} from '../lib/financial-group-open-items';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
import {openItemFixture} from './financial-reporting/group-open-item-fixture';
const event='50000000-0000-4000-8000-000000000001',record='60000000-0000-4000-8000-000000000001';
function fixture(){const {entry}=sourceBoundGroupFixture();return{entry,evidence:openItemFixture(entry)}}
function paid(f:ReturnType<typeof fixture>,amount='70',date='2026-10-01'){
 const s=f.evidence[0];s.events.push({id:event,organization_id:s.organizationId,event_date:date,status:'ACTUAL',base_currency:'SAR'});
 s.allocations.push({id:record,organization_id:s.organizationId,application_event_id:event,obligation_id:s.roots[0].id,base_currency:'SAR',base_amount:amount});
}
const verify=(f:ReturnType<typeof fixture>)=>verifyGroupOpenItems([f.entry],'2026-12-31','SAR',f.evidence);
it('uses actual document remaining amounts on both companies and preserves evidence',()=>{const f=fixture();paid(f,'25');const original=structuredClone(f);expect(verify(f).bindings.map(b=>b.outstanding)).toEqual(['75.0000','100.0000']);expect(f).toEqual(original)});
it('rejects a paid invoice even when the source leaf account contains other outstanding invoices',()=>{const f=fixture();paid(f,'100');expect(()=>verify(f)).toThrow('GROUP_ADJUSTMENT_EXCEEDS_OPEN_ITEM')});
it('deducts posted credit notes but ignores drafts and applications after the report date',()=>{const f=fixture();paid(f,'90','2027-01-01');expect(verify(f).bindings[0].outstanding).toBe('100.0000');const s=f.evidence[0];s.events[1].event_date='2026-10-01';s.events[1].status='DRAFT';expect(verify(f).bindings[0].outstanding).toBe('100.0000');s.allocations=[];s.events[1].status='ACTUAL';s.notes=[{...s.roots[0],id:record,event_id:event,adjusts_obligation_id:s.roots[0].id,adjustment_effect:'DECREASE',settleable_base_amount:'70'}];expect(()=>verify(f)).toThrow('GROUP_ADJUSTMENT_EXCEEDS_OPEN_ITEM')});
it('uses the reversal date rather than treating a historically posted payment as never made',()=>{const f=fixture();paid(f);const s=f.evidence[0],reverse='70000000-0000-4000-8000-000000000001';s.events[1].status='REVERSED';s.events.push({...s.events[1],id:reverse,status:'ACTUAL',event_date:'2027-01-01'});s.reversals=[{id:'80000000-0000-4000-8000-000000000001',organization_id:s.organizationId,event_id:reverse,related_event_id:event}];expect(()=>verify(f)).toThrow('GROUP_ADJUSTMENT_EXCEEDS_OPEN_ITEM');s.events[2].event_date='2026-12-01';expect(verify(f).bindings[0].outstanding).toBe('100.0000');s.reversals=[];expect(()=>verify(f)).toThrow('REPORTING_GROUP_OPEN_ITEMS_INVALID')});
it('shares consumption between lines of one invoice and rejects ambiguous obligations',()=>{const f=fixture();f.entry.amount='60';expect(()=>verifyGroupOpenItems([f.entry,{...f.entry,id:'90000000-0000-4000-8000-000000000001'}],'2026-12-31','SAR',f.evidence)).toThrow('GROUP_ADJUSTMENT_EXCEEDS_OPEN_ITEM');f.evidence[0].roots.push({...f.evidence[0].roots[0],id:record});expect(()=>verify(f)).toThrow('GROUP_ADJUSTMENT_OPEN_ITEM_AMBIGUOUS')});
it('shows one residual per obligation using all adjustments and posted settlements',()=>{
 const f=fixture();
 paid(f,'25');
 f.entry.amount='50';
 const extra={...f.entry,id:'90000000-0000-4000-8000-000000000001',amount:'25'};
 expect(verifyGroupOpenItems([f.entry,extra],'2026-12-31','SAR',f.evidence).residuals).toEqual([{
  organizationId:f.entry.creditSource.organizationId,obligationId:f.evidence[1].roots[0].id,
  eventId:f.entry.creditSource.eventId,kind:'RECEIVABLE',
  outstanding:'100.0000',eliminated:'75.0000',remaining:'25.0000',
 }]);
 expect(verifyGroupOpenItems([],'2026-12-31','SAR',[]).residuals).toEqual([]);
});
it('rejects foreign, incomplete, wrong-currency, overpaid and differently dated evidence',()=>{let f=fixture();f.evidence[0].events=[];expect(()=>verify(f)).toThrow('REPORTING_GROUP_OPEN_ITEMS_INVALID');f=fixture();paid(f,'101');expect(()=>verify(f)).toThrow('REPORTING_GROUP_OPEN_ITEMS_UNRECONCILED');f=fixture();f.entry.date='2026-12-30';expect(()=>verify(f)).toThrow('GROUP_ADJUSTMENT_BALANCE_DATE_REQUIRED');f=fixture();f.evidence[0].roots[0].base_currency='USD';expect(()=>verify(f)).toThrow('GROUP_ADJUSTMENT_OPEN_ITEM_UNAVAILABLE');f=fixture();f.evidence[0].roots[0].organization_id=f.evidence[1].organizationId;expect(()=>verify(f)).toThrow('REPORTING_GROUP_OPEN_ITEMS_INVALID')});
