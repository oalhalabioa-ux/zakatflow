import {expect,it} from 'vitest';
import {aggregateDimensionalOpenings,type DimensionalOpeningWorkspace,type DimensionalOpeningDistribution} from '../lib/financial-dimensional-openings';
import {projectDimensionalStatements} from '../lib/financial-dimensional-statements';
import type {StatementSource} from '../lib/financial-statement-engine';
function fixture(){
 const source:StatementSource={organizationId:'org',currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-12-31',journals:[],accounts:[{id:'bank',organizationId:'org',currency:'SAR',kind:'ASSET',cash:true},{id:'capital',organizationId:'org',currency:'SAR',kind:'EQUITY'}],opening:[{accountId:'bank',debit:'100',credit:'0'},{accountId:'capital',debit:'0',credit:'100'}]};
 const w:DimensionalOpeningWorkspace={id:'w',organizationId:'org',currency:'SAR',fiscalStart:'2026-01-01',version:2,digest:'server-digest',status:'APPROVED',items:[{itemId:'first-bank-voucher',accountId:'bank',debit:'60',credit:'0'},{itemId:'second-bank-voucher',accountId:'bank',debit:'40',credit:'0'},{itemId:'capital-voucher',accountId:'capital',debit:'0',credit:'100'}]};
 const a=(debit:string,credit:string,centerId='sales')=>({branchId:'branch',centerId,debit,credit});
 const d:DimensionalOpeningDistribution={id:'d',organizationId:'org',openingWorkspaceId:'w',openingVersion:2,openingDigest:'server-digest',status:'APPROVED',approvedBy:'approver',revision:'1',entries:{'first-bank-voucher':[a('60','0')],'second-bank-voucher':[a('40','0','admin')],'capital-voucher':[a('0','60'),a('0','40','admin')]}};
 return{source,w,d};
}
it('connects distinct approved vouchers sharing an account to three reconciled statements',()=>{
 const {source,w,d}=fixture(),before=structuredClone({source,w,d});
 const opening=aggregateDimensionalOpenings(source,w,d);
 const r=projectDimensionalStatements(source,{organizationId:'org',revision:'1',branches:['branch'],centers:[{id:'sales',branchId:'branch'},{id:'admin',branchId:'branch'}],opening,movements:[]});
 expect(r.rows.find(r=>r.centerId==='sales')?.statements.cash.opening).toBe('60.0000');
 expect(r.rows.find(r=>r.centerId==='admin')?.statements.position.assets).toBe('40.0000');
 expect(r.company.cash.opening).toBe('100.0000');expect({source,w,d}).toEqual(before);
});
it('refuses stale approvals, foreign scope and modified opening digests',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>f.w.version++, (f:ReturnType<typeof fixture>)=>f.d.openingDigest='changed',(f:ReturnType<typeof fixture>)=>f.d.organizationId='other',(f:ReturnType<typeof fixture>)=>f.d.approvedBy='']){
  const f=fixture();mutate(f);expect(()=>aggregateDimensionalOpenings(f.source,f.w,f.d)).toThrow('DIMENSION_OPENING_SOURCE_STALE');
 }
});
it('refuses redistributing one voucher under another even when account total is unchanged',()=>{
 const f=fixture();f.d.entries['first-bank-voucher'][0].debit='40';f.d.entries['second-bank-voucher'][0].debit='60';
 expect(()=>aggregateDimensionalOpenings(f.source,f.w,f.d)).toThrow('DIMENSION_OPENING_ITEM_UNRECONCILED');
});
it('rejects missing, extra and duplicate allocations',()=>{
 let f=fixture();delete f.d.entries['first-bank-voucher'];expect(()=>aggregateDimensionalOpenings(f.source,f.w,f.d)).toThrow('DIMENSION_OPENING_ITEM_MISSING');
 f=fixture();f.d.entries.invented=f.d.entries['first-bank-voucher'];expect(()=>aggregateDimensionalOpenings(f.source,f.w,f.d)).toThrow('DIMENSION_OPENING_ITEM_EXTRA');
 f=fixture();f.d.entries['first-bank-voucher']=[...f.d.entries['first-bank-voucher'],...f.d.entries['first-bank-voucher']];expect(()=>aggregateDimensionalOpenings(f.source,f.w,f.d)).toThrow('DIMENSION_OPENING_PART_INVALID');
});
