import {describe,expect,it} from 'vitest';
import {openingAccountMenuPosition} from '../components/financial-reports/OpeningAccountPicker';
import {financialDraftOpeningReport} from '../lib/financial-draft-opening-report';
import {endingForFiscalStart} from '../lib/financial-fiscal-end';
import type {OpeningWorkspaceData} from '../lib/financial-opening-workspace';

const chart:OpeningWorkspaceData['chart']=[
 {id:'cash',code:'1000',ar:'النقد والبنوك',en:'Cash & banks',kind:'ASSET',cash:true,presentation:'CURRENT'},
 {id:'capital',code:'3100',ar:'رأس المال',en:'Share capital',kind:'EQUITY',cash:false,presentation:'OTHER'},
];
const source:OpeningWorkspaceData['source']={revision:'revision-a',financialRevision:'revision-b',rows:[
 {id:'cash:1',tab:'cash',accountCode:'1000',accountAr:'النقد والبنوك',accountEn:'Cash & banks',ar:'البنك',en:'Bank',normal:'DEBIT',sourceIssue:null,vouchers:[]},
 {id:'equity:3100',tab:'equity',accountCode:'3100',accountAr:'رأس المال',accountEn:'Share capital',ar:'رأس المال',en:'Capital',normal:'CREDIT',sourceIssue:null,vouchers:[]},
]};
function fixture():OpeningWorkspaceData{return{
 organizationId:'00000000-0000-4000-8000-000000000001',fiscalStart:'2026-01-01',cutoff:'2025-12-31',currency:'SAR',chart,source,
 workspace:{id:'00000000-0000-4000-8000-000000000002',version:2,status:'DRAFT',source_revision:'revision-a',reason:'',approved_at:null,approved_by:null,
  entries:{'cash:1':{amount:'100',side:'DEBIT'},'equity:3100':{amount:'100',side:'CREDIT'}}},canSave:true,canApprove:true,
}};

describe('opening account dropdown visible placement',()=>{
 it('opens upward when a long list would be clipped near the bottom',()=>{
  const p=openingAccountMenuPosition({top:740,bottom:780,left:1400,right:1800,width:400},{width:1900,height:950},20);
  expect(p.placement).toBe('above');expect(p.top).toBeGreaterThanOrEqual(12);expect(p.top+p.maxHeight).toBeLessThanOrEqual(740);
 });
 it('limits menu height within the viewport, retaining internal scrolling',()=>{
  const p=openingAccountMenuPosition({top:180,bottom:220,left:20,right:400,width:380},{width:680,height:380},30);
  expect(p.maxHeight).toBeLessThanOrEqual(350);expect(p.top+p.maxHeight).toBeLessThanOrEqual(380-12);
 });
 it('does not extend the menu horizontally off small screens',()=>{
  const p=openingAccountMenuPosition({top:70,bottom:110,left:295,right:650,width:355},{width:360,height:600},10);
  expect(p.left).toBeGreaterThanOrEqual(12);expect(p.left+p.width).toBeLessThanOrEqual(348);
 });
});

describe('saved draft read-only financial preview',()=>{
 it('offers January and July fiscal periods before their opening is approved',()=>{
  expect(endingForFiscalStart('2026-01-01')).toBe('2026-12-31');
  expect(endingForFiscalStart('2026-07-01')).toBe('2027-06-30');
 });
 it('shows balanced opening cash and equity without approving or modifying the draft',()=>{
  const source=fixture(),before=JSON.stringify(source);
  const result=financialDraftOpeningReport(source)!;
  expect(result).toMatchObject({balanced:true,pending:0,sourceChanged:false,assets:'100.0000',equity:'100.0000',cash:'100.0000',debit:'100.0000',credit:'100.0000'});
  expect(JSON.stringify(source)).toBe(before);
 });
 it('rejects an already approved record as a draft preview',()=>{
  const source=fixture();source.workspace!.status='APPROVED';expect(financialDraftOpeningReport(source)).toBeNull();
 });
 it('marks a stale source revision so the UI hides its financial amounts',()=>{
  const source=fixture();source.source.revision='revision-updated';expect(financialDraftOpeningReport(source)?.sourceChanged).toBe(true);
 });
});
