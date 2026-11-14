import {expect,it} from 'vitest';
import {projectDimensionalStatements,type DimensionEvidence} from '../lib/financial-dimensional-statements';
import type {StatementSource} from '../lib/financial-statement-engine';
function fixture(){
 const source:StatementSource={organizationId:'org',currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-12-31',accounts:[
  {id:'bank',organizationId:'org',currency:'SAR',kind:'ASSET',cash:true},
  {id:'capital',organizationId:'org',currency:'SAR',kind:'EQUITY'},
  {id:'expense',organizationId:'org',currency:'SAR',kind:'OPEX'},
 ],opening:[{accountId:'bank',debit:'1000',credit:'0'},{accountId:'capital',debit:'0',credit:'1000'}],journals:[
  {id:'expense',organizationId:'org',currency:'SAR',date:'2026-02-01',status:'POSTED',lines:[{accountId:'expense',debit:'100',credit:'0'},{accountId:'bank',debit:'0',credit:'100',cashActivity:'OPERATING'}]},
 ]};
 const split=(debit:string,credit:string)=>[
  {branchId:'riyadh',centerId:'sales',debit,credit},
  {branchId:'jeddah',centerId:'operations',debit,credit},
 ];
 const evidence:DimensionEvidence={organizationId:'org',revision:'approved-dated-allocation-1',branches:['riyadh','jeddah'],centers:[{id:'sales',branchId:'riyadh'},{id:'operations',branchId:'jeddah'}],
  opening:[{accountId:'bank',allocations:split('500','0')},{accountId:'capital',allocations:split('0','500')}],
  movements:[{journalId:'expense',lineIndex:0,allocations:split('50','0')},{journalId:'expense',lineIndex:1,allocations:split('0','50')}],
 };
 return{source,evidence};
}
it('reconciles two branches and centers across income, position and cash without mutating sources',()=>{
 const {source,evidence}=fixture(),before=structuredClone({source,evidence});
 const r=projectDimensionalStatements(source,evidence);
 expect(r.rows).toHaveLength(2);
 for(const row of r.rows){expect(row.statements.income.netProfit).toBe('-50.0000');expect(row.statements.position.assets).toBe('450.0000');expect(row.statements.cash).toMatchObject({opening:'500.0000',operating:'-50.0000',closing:'450.0000'});}
 expect(r.company.cash.closing).toBe('900.0000');expect({source,evidence}).toEqual(before);
});
it('rejects a center under a different branch and incomplete opening evidence',()=>{
 let f=fixture();f.evidence.centers=[{id:'sales',branchId:'jeddah'},{id:'operations',branchId:'jeddah'}];
 expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('DIMENSION_BRANCH_CENTER_MISMATCH');
 f=fixture();f.evidence.opening=[];expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('DIMENSION_OPENING_INCOMPLETE');
});
it('rejects missing, extra, duplicate and overallocated source lines',()=>{
 let f=fixture();f.evidence.movements=f.evidence.movements.slice(1);expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('DIMENSION_MOVEMENT_INCOMPLETE');
 f=fixture();f.evidence.movements=[...f.evidence.movements,{...f.evidence.movements[0],journalId:'invented'}];expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('DIMENSION_MOVEMENT_EXTRA');
 f=fixture();f.evidence.movements=[...f.evidence.movements,f.evidence.movements[0]];expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('DIMENSION_MOVEMENT_DUPLICATE');
 f=fixture();f.evidence.movements[0].allocations[0].debit='51';expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('DIMENSION_ALLOCATION_UNRECONCILED');
});
it('never invents a counterpart to make a center balance',()=>{
 const f=fixture();f.evidence.movements[0].allocations[0].debit='60';f.evidence.movements[0].allocations[1].debit='40';
 expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('JOURNAL_UNBALANCED');
});
it('preserves reversal attribution and detects a reversal assigned to the wrong center',()=>{
 const f=fixture();f.source.journals.push({...f.source.journals[0],id:'reverse',date:'2026-03-01',reversesJournalId:'expense',lines:f.source.journals[0].lines.map(l=>({...l,debit:l.credit,credit:l.debit}))});
 const reverse=f.evidence.movements.map(m=>({...m,journalId:'reverse',allocations:m.allocations.map(a=>({...a,debit:a.credit,credit:a.debit}))}));
 f.evidence.movements=[...f.evidence.movements,...reverse];
 const r=projectDimensionalStatements(f.source,f.evidence);expect(r.rows.every(r=>r.statements.income.netProfit==='0.0000')).toBe(true);
 reverse[0].allocations[0].credit='60';reverse[0].allocations[1].credit='40';reverse[1].allocations[0].debit='60';reverse[1].allocations[1].debit='40';
 expect(()=>projectDimensionalStatements(f.source,f.evidence)).toThrow('REVERSAL_DOES_NOT_MATCH_SOURCE');
});
