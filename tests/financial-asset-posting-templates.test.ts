import {it,expect} from 'vitest';
import {defaultPostingRules} from '../lib/financial-default-posting-rules';
import {compileEventLedger,type EventLedgerInput,type RecognitionEvent} from '../lib/financial-event-ledger';
const roots=['1100','1500','1600','1590','2300','3100','4100','6100','6200'];
const chart=roots.map(code=>({id:code,code,cash:false}));
const classifications=['OPEX','REVENUE','ASSET','TAX'].map(code=>({id:code,code,name:code,classification_type:code,active:true}));
const lifecycle=()=>defaultPostingRules(classifications,chart).rules.filter(r=>r.sourceModule==='ASSET_LIFECYCLE');
it('prepares distinct canonical roles without guessing legacy BASE or copying them to arbitrary classifications',()=>{
 expect(lifecycle().filter(r=>!r.classificationId.includes(':INVESTMENT_')).map(r=>[r.classificationId,r.debitAccountId,r.creditAccountId])).toEqual([
  ['OPEX:DEPRECIATION','6200','1590'],['OPEX:DISPOSAL_LOSS','6100','1500'],['OPEX:SALE_LOSS','6100','1100'],
  ['REVENUE:SALE_GAIN','1100','4100'],['ASSET:SALE_NET_BOOK_VALUE','1100','1500'],['ASSET:ACCUMULATED_DEPRECIATION_RELEASE','1590','1500'],['TAX:OUTPUT_VAT','1100','2300'],
 ]);
 expect(defaultPostingRules(classifications.map(c=>({...c,code:'CUSTOM_'+c.code})),chart).rules.filter(r=>r.sourceModule==='ASSET_LIFECYCLE')).toEqual([]);
});
it('compiles depreciation, sale loss plus VAT and disposal into balanced statements with no residual gross asset or depreciation',()=>{
 const events:RecognitionEvent[]=[
  ['dep',[['OPEX:DEPRECIATION','100']]],
  ['sale',[['OPEX:SALE_LOSS','50'],['ASSET:SALE_NET_BOOK_VALUE','450'],['TAX:OUTPUT_VAT','60'],['ASSET:ACCUMULATED_DEPRECIATION_RELEASE','50']]],
  ['disposal',[['OPEX:DISPOSAL_LOSS','450'],['ASSET:ACCUMULATED_DEPRECIATION_RELEASE','50']]],
 ].map(([key,lines],i)=>({id:String(key),organizationId:'org',currency:'SAR',date:`2026-0${i+2}-01`,eventType:'ADJUSTMENT',sourceModule:'ASSET_LIFECYCLE',sourceKey:String(key),status:'ACTUAL',lines:(lines as string[][]).map(([classificationId,baseAmount],n)=>({id:`${key}-${n}`,classificationId,baseAmount,cashDirection:'NON_CASH',recognitionSign:1}))}));
 const input:EventLedgerInput={organizationId:'org',currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-12-31',openingSourceId:'opening',
  accounts:roots.map(id=>({id,organizationId:'org',currency:'SAR',cash:false,kind:id==='3100'?'EQUITY':id==='2300'?'LIABILITY':id==='4100'?'REVENUE':['6100','6200'].includes(id)?'OPEX':'ASSET'})),
  opening:[{accountId:'1500',debit:'1000',credit:'0'},{accountId:'3100',debit:'0',credit:'1000'}],events,
  policy:{id:'approved',organizationId:'org',currency:'SAR',approvedBy:'owner',approvedAt:'2026-01-01T00:00:00Z',rules:lifecycle().map((r,i)=>({...r,id:String(i),organizationId:'org',currency:'SAR',from:'2026-01-01',to:'2026-12-31'}))}};
 const result=compileEventLedger(input);
 const movement=(id:string)=>result.source.journals.flatMap(j=>j.lines).filter(l=>l.accountId===id).reduce((n,l)=>n+Number(l.debit)-Number(l.credit),0);
 expect(movement('1500')).toBe(-1000);expect(movement('1590')).toBe(0);expect(movement('1100')).toBe(460);expect(movement('2300')).toBe(-60);
 expect(result.lineage).toHaveLength(7);
});

it('keeps investment release on the investment control instead of fixed assets',()=>{
 const release=lifecycle().find(r=>r.classificationId==='ASSET:INVESTMENT_SALE_NET_BOOK_VALUE');
 expect(release?.creditAccountId).toBe('1600');
 expect(lifecycle().find(r=>r.classificationId==='OPEX:INVESTMENT_DISPOSAL_LOSS')?.creditAccountId).toBe('1600');
});
