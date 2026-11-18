import {describe,it,expect} from 'vitest';
import {approvedGroupWorksheetCsv,groupAcquisitionPositionCsv} from '../lib/financial-group-worksheet-export';
import {groupStatementWorksheet} from '../lib/financial-group-statement-worksheet';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
function fixture(){
 const f=sourceBoundGroupFixture();
 const query={organization:f.control.rootOrganizationId,from:f.control.from,to:f.control.to};
 const data={status:'APPROVED_GROUP_ADJUSTMENT_WORKSHEET',consolidated:false,control:{rootOrganizationId:query.organization},approval:{id:'60000000-0000-4000-8000-000000000001',version:3,approvedBy:'70000000-0000-4000-8000-000000000001',approvedAt:'2026-12-31T00:00:00Z'},statementWorksheet:groupStatementWorksheet(f.control,f.sources,[],[])};
 return{query,data};
}
describe('approved review worksheet CSV',()=>{
 it('labels its limited purpose and includes exact scope, approval and bilingual statement rows',()=>{
  const f=fixture(),csv=approvedGroupWorksheetCsv(f.data,f.query);
  expect(csv.startsWith('\uFEFF')).toBe(true);expect(csv).toContain('NOT final consolidated statements');
  expect(csv).toContain(f.query.organization);expect(csv).toContain('"Approved version","3"');
  expect(csv).toContain('"income","Net profit","صافي الربح"');expect(csv).toContain('"position","Equity","حقوق الملكية"');expect(csv).toContain('"cash","Closing cash","النقد آخر الفترة"');
 });
 it('refuses a different organization or period, rather than exporting an old selection',()=>{
  const f=fixture();for(const q of [{...f.query,organization:'80000000-0000-4000-8000-000000000001'},{...f.query,from:'2026-02-01'}])expect(()=>approvedGroupWorksheetCsv(f.data,q)).toThrow('GROUP_EXPORT_SCOPE_MISMATCH');
 });
 it('refuses unapproved or final-statement claims',()=>{
  const f=fixture();for(const change of [{status:'SOURCE_BOUND_GROUP_PREVIEW_ONLY'},{consolidated:true},{approval:null}])expect(()=>approvedGroupWorksheetCsv({...f.data,...change},f.query)).toThrow();
 });
 it('rejects spreadsheet formulas, malformed amounts and substituted rows',()=>{
  for(const value of ['=HYPERLINK("https://bad")','+1','@SUM(1)','NaN','1e8']){const f=fixture();f.data.statementWorksheet.income[0].after=value;expect(()=>approvedGroupWorksheetCsv(f.data,f.query)).toThrow();}
  const f=fixture();f.data.statementWorksheet.income.reverse();expect(()=>approvedGroupWorksheetCsv(f.data,f.query)).toThrow('GROUP_EXPORT_ROWS_INVALID');
 });
 it('requires the full nonduplicated member identity and all three statement row sets',()=>{
  const f=fixture();f.data.statementWorksheet.memberIds.push(f.query.organization);expect(()=>approvedGroupWorksheetCsv(f.data,f.query)).toThrow('GROUP_EXPORT_SCOPE_MISMATCH');
  const g=fixture();g.data.statementWorksheet.cash.pop();expect(()=>approvedGroupWorksheetCsv(g.data,g.query)).toThrow();
 });
});

it('exports verified acquisition amounts separately and escapes spreadsheet formulas in company names',()=>{
 const {data,query}=fixture();
 const subsidiaryOrganizationId=data.statementWorksheet.memberIds.find(id=>id!==query.organization)!;
 const review={status:'APPROVED_ACQUISITION_REVIEW',query,rows:[{
  id:data.approval.id,subsidiaryName:' =SUM(1,2)',approvedAt:data.approval.approvedAt,documentCount:1,
  calculation:{status:'ACQUISITION_MEASUREMENT_ONLY',consolidated:false,issuanceReady:false,
   reassessmentRequired:false,parentOrganizationId:query.organization,subsidiaryOrganizationId,
   acquisitionDate:query.from,currency:data.statementWorksheet.currency,consideration:'1200.0000',
   identifiableNetAssets:'1000.0000',goodwill:'200.0000',nciAtAcquisition:'0.0000'},
 }]};
 const csv=approvedGroupWorksheetCsv({...data,acquisitionReview:review},query);
 expect(csv).toContain('Goodwill / الشهرة');
 expect(csv).toContain('"1200.0000","1000.0000","200.0000","0.0000"');
 expect(csv).toContain("' =SUM(1,2)");
 review.rows[0].calculation.subsidiaryOrganizationId=query.organization;
 expect(()=>approvedGroupWorksheetCsv({...data,acquisitionReview:review},query)).toThrow('GROUP_EXPORT_SCOPE_MISMATCH');
});

it('exports the adjusted statements and the inventory evidence from the same scope',()=>{
 const {data,query}=fixture();
 const s=data.statementWorksheet,acquisitionId='90000000-0000-4000-8000-000000000001';
 const result={
  status:'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',query,currency:s.currency,approval:data.approval,
  memberIds:s.memberIds,acquisitionRecordIds:[acquisitionId],
  rows:s.position.filter(row=>row.key!=='fiscalProfit'),income:s.income,statementCash:s.cash,
  profitAttribution:{total:'160.0000',parent:'128.0000',nci:'32.0000'},
  closingParentEquity:'128.0000',closingNci:'32.0000',
  inventoryEliminations:[{
   sellerOrganizationId:s.memberIds.find(id=>id!==query.organization),buyerOrganizationId:query.organization,
   inventoryAccountId:'170098',inventoryReduction:'200.0000',
   deferredTax:{approvedRecordId:acquisitionId,evidenceDocumentId:'90000000-0000-4000-8000-000000000002',
    deferredTaxAssetIncrease:'40.0000',groupAfterTaxProfitReduction:'160.0000'},
   afterTaxAttribution:{parent:'128.0000',nonControllingInterests:'32.0000'},
  }],
 };
 const csv=groupAcquisitionPositionCsv(result,query);
 expect(csv.startsWith('\uFEFF')).toBe(true);
 expect(csv).toContain('"cash","Closing cash","النقد آخر الفترة"');
 expect(csv).toContain('"170098","200.0000","40.0000","160.0000","128.0000","32.0000"');
 expect(csv).toContain('"Non-controlling interests / غير المسيطرين","32.0000"');
 expect(()=>groupAcquisitionPositionCsv(result,{...query,to:'2026-03-01'})).toThrow('GROUP_EXPORT_SCOPE_MISMATCH');
 expect(()=>groupAcquisitionPositionCsv({...result,status:'ACQUISITION_POSITION_UNAVAILABLE'},query)).toThrow();
 result.inventoryEliminations[0].deferredTax.approvedRecordId=data.approval.id;
 expect(()=>groupAcquisitionPositionCsv(result,query)).toThrow('GROUP_EXPORT_SCOPE_MISMATCH');
});
