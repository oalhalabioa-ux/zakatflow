import {expect,it} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {compileDimensionalEventStatements,compileRegisteredDimensionalStatements,type EventDimensionEvidence} from '../lib/financial-dimensional-event-source';
import type {DimensionalOpeningWorkspace,DimensionalOpeningDistribution} from '../lib/financial-dimensional-openings';
function fixture(){
 const raw=branchFixture().source;
 const query={organization:raw.organizationId,from:raw.from,to:raw.to};
 const w:DimensionalOpeningWorkspace={id:raw.openingSourceId,organizationId:raw.organizationId,fiscalStart:raw.fiscalStart,currency:raw.currency,version:1,digest:'verified',status:'APPROVED',items:raw.opening.map(r=>({...r,itemId:r.accountId}))};
 const d:DimensionalOpeningDistribution={id:'distribution',organizationId:raw.organizationId,openingWorkspaceId:w.id,openingVersion:1,openingDigest:'verified',status:'APPROVED',approvedBy:'owner',revision:'1',entries:Object.fromEntries(w.items.map(r=>[r.itemId,[{branchId:null,centerId:null,debit:r.debit,credit:r.credit}]]))};
 const evidence:EventDimensionEvidence={organizationId:raw.organizationId,revision:'1',branches:['branch'],centers:[{id:'sales',branchId:'branch'},{id:'operations',branchId:'branch'}],links:raw.events.flatMap(e=>e.lines.map(l=>({eventId:e.id,lineId:l.id,branchId:'branch',centerId:e.eventType==='REVENUE'?'sales':'operations'})))};
 return{raw,query,evidence,w,d};
}
it('reconciles all three statements using original recognition lines and approved voucher openings',()=>{
 const f=fixture();const r=compileDimensionalEventStatements(f.raw,f.query,f.evidence,f.w,f.d);
 expect(r.rows.find(r=>r.centerId==='sales')?.statements.income.netProfit).toBe('50.0000');
 expect(r.rows.find(r=>r.centerId==='operations')?.statements.income.netProfit).toBe('-107.5000');
 expect(r.rows.find(r=>r.centerId===null)?.statements.cash.opening).toBe('500.0000');
 expect(r.company.income.netProfit).toBe('-57.5000');
});
it('refuses missing, duplicate and invented recognition links',()=>{
 let f=fixture();f.evidence.links=f.evidence.links.slice(1);expect(()=>compileDimensionalEventStatements(f.raw,f.query,f.evidence,f.w,f.d)).toThrow('DIMENSION_SOURCE_LINK_MISSING');
 f=fixture();f.evidence.links=[...f.evidence.links,f.evidence.links[0]];expect(()=>compileDimensionalEventStatements(f.raw,f.query,f.evidence,f.w,f.d)).toThrow('DIMENSION_SOURCE_LINK_DUPLICATE');
 f=fixture();f.evidence.links=[...f.evidence.links,{...f.evidence.links[0],lineId:'invented'}];expect(()=>compileDimensionalEventStatements(f.raw,f.query,f.evidence,f.w,f.d)).toThrow('DIMENSION_SOURCE_LINK_EXTRA');
});
it('refuses mismatched opening workspace and center branch',()=>{
 const f=fixture();f.w.id='other';f.d.openingWorkspaceId='other';expect(()=>compileDimensionalEventStatements(f.raw,f.query,f.evidence,f.w,f.d)).toThrow('DIMENSION_SOURCE_SCOPE_INVALID');
 const g=fixture();g.evidence.links=[{...g.evidence.links[0],branchId:null},...g.evidence.links.slice(1)];expect(()=>compileDimensionalEventStatements(g.raw,g.query,g.evidence,g.w,g.d)).toThrow('DIMENSION_BRANCH_CENTER_MISMATCH');
});

it('does not require invented opening allocations for an explicitly verified first-activity company',()=>{
 const f=fixture();f.raw.opening=[];f.raw.openingSourceId=`FIRST_ACTIVITY:${f.raw.fiscalStart}`;
 // Independent register control must reflect the new source, not the old opening.
 if('controls' in f.raw)delete (f.raw as {controls?:unknown}).controls;
 const r=compileDimensionalEventStatements(f.raw,f.query,f.evidence,null,null);
 expect(r.company.cash.opening).toBe('0.0000');
 expect(r.company.income.netProfit).toBe('-57.5000');
 expect(()=>compileDimensionalEventStatements(f.raw,f.query,f.evidence,f.w,f.d)).toThrow();
 const original=fixture();expect(()=>compileDimensionalEventStatements(original.raw,original.query,original.evidence,null,null)).toThrow('DIMENSION_OPENING_APPROVAL_REQUIRED');
});

it('requires historical branch coverage from fiscal start even for a later display period',()=>{
 const f=fixture();const registry={organizationId:f.raw.organizationId,complete:true as const,revision:'1',branches:['branch'],centerIds:['sales','operations'],assignments:['sales','operations'].map(centerId=>({id:centerId,organizationId:f.raw.organizationId,centerId,branchId:'branch',from:f.raw.fiscalStart,to:null,status:'APPROVED' as const,approvedBy:'owner',revision:'1'}))};
 expect(compileRegisteredDimensionalStatements(f.raw,f.query,f.evidence,registry,f.w,f.d).company.income.netProfit).toBe('-57.5000');
 registry.assignments[0].from=f.raw.fiscalStart.slice(0,4)+'-02-01';
 expect(()=>compileRegisteredDimensionalStatements(f.raw,f.query,f.evidence,registry,f.w,f.d)).toThrow('CENTER_BRANCH_PERIOD_INCOMPLETE');
});
