import type {GroupOpenItemEvidence} from '../../lib/financial-group-open-items';
import type {SourceBoundAdjustment} from '../../lib/financial-group-source-bound-adjustments';
export function openItemFixture(entry:SourceBoundAdjustment):GroupOpenItemEvidence[]{
 return [entry.debitSource,entry.creditSource].map((r,i)=>({organizationId:r.organizationId,
  roots:[{id:`40000000-0000-4000-8000-00000000000${i+1}`,organization_id:r.organizationId,event_id:r.eventId,obligation_type:i===0?'PAYABLE':'RECEIVABLE',adjusts_obligation_id:null,adjustment_effect:'INCREASE',base_currency:'SAR',settleable_base_amount:'100'}],
  notes:[],allocations:[],reversals:[],events:[{id:r.eventId,organization_id:r.organizationId,event_date:'2026-01-15',status:'ACTUAL',base_currency:'SAR'}],
 }));
}
