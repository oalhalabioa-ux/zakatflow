import {describe,expect,it} from 'vitest';
import {createIndustrialStarter,createRawLandStarter} from './project-templates';
import {createStudy,evaluateStudy,waterFactoryLegalItems} from './engine';
import {feasibilityDraftSchema} from './draft-schema';

const id='be2f26f9-196a-4d96-87c5-927eb34d4e11';

describe('opt-in industrial templates for all Yaqeen tenants',()=>{
 it('makes a bottled-water factory study without fabricated money or approvals',()=>{
  const s=createIndustrialStarter(id,'مصنع مياه معبأة','BOTTLED_WATER');
  expect(feasibilityDraftSchema.safeParse(s).success).toBe(true);
  expect(s.sector).toBe('INDUSTRIAL');
  expect(s.country).toBe('');
  expect(s.currency).toBe('');
  expect(s.landTransferred).toBe(false);
  expect(s.landValue).toBe(0);
  expect(s.investorEquity).toBe(0);
  expect(s.partnerCashEquity).toBe(0);
  expect(s.investorLoan).toBe(0);
  expect(s.capex.every(item=>item.amount===0)).toBe(true);
  expect(s.capex.some(item=>item.label.includes('تعبئة المياه'))).toBe(true);
  expect(waterFactoryLegalItems.every(item=>s.legal.some(x=>x.title===item))).toBe(true);
  expect(s.legal.every(x=>x.status==='NOT_STARTED')).toBe(true);
  expect(evaluateStudy(s).npv).toBeNull();
  expect(evaluateStudy(s).irr).toBeNull();
 });
 it('makes a dairy study with cold chain and raw-milk requirements, not water-specific licences',()=>{
  const s=createIndustrialStarter(id,'مصنع ألبان وأجبان','DAIRY_CHEESE');
  expect(feasibilityDraftSchema.safeParse(s).success).toBe(true);
  expect(s.capex.some(x=>x.label.includes('التبريد'))).toBe(true);
  expect(s.tasks.some(x=>x.title.includes('الحليب الخام'))).toBe(true);
  expect(s.legal.some(x=>x.title.includes('الألبان والأجبان'))).toBe(true);
  expect(s.legal.some(x=>waterFactoryLegalItems.includes(x.title as typeof waterFactoryLegalItems[number]))).toBe(false);
  expect(s.capex.every(x=>x.amount===0)).toBe(true);
  expect(s.country).toBe('');
 });
 it('does not change existing general study defaults or records',()=>{
  const general=createStudy(id,'Existing generic project','INDUSTRIAL');
  const recreated=createIndustrialStarter(id,'Existing generic project','GENERAL');
  expect(recreated.capex).toEqual(general.capex);
  expect(recreated.legal).toEqual(general.legal);
  expect(recreated.tasks).toEqual(general.tasks);
  expect(general.capex).toHaveLength(3);
 });
 it('generates unique line identifiers and valid draft documents',()=>{
  for(const template of ['BOTTLED_WATER','DAIRY_CHEESE'] as const){
   const s=createIndustrialStarter(id,template,template);
   for(const lines of [s.capex,s.tasks,s.legal]){
    expect(new Set(lines.map(x=>x.id)).size).toBe(lines.length);
   }
   expect(feasibilityDraftSchema.safeParse(s).success).toBe(true);
  }
 });
 it('keeps edited water studies and new public starters independent',()=>{
  const privateStudy=createIndustrialStarter(id,'Private synthetic project','BOTTLED_WATER');
  privateStudy.country='Synthetic country';
  privateStudy.notes='Private synthetic notes';
  privateStudy.water!.deal.landValue=987654;
  privateStudy.water!.ops.priceCarton=321;
  privateStudy.water!.ops.util[0]=77;
  privateStudy.legal[0].notes='Private synthetic evidence';
  const original=structuredClone(privateStudy);
  const fresh=createIndustrialStarter('another-user-study','New public water study','BOTTLED_WATER');
  expect(fresh.country).toBe('');
  expect(fresh.notes??'').toBe('');
  expect(fresh.water!.deal.landValue).toBe(0);
  expect(fresh.water!.ops.priceCarton).toBe(0);
  expect(fresh.water!.ops.util[0]).not.toBe(77);
  expect(fresh.legal.every(item=>item.notes==='')).toBe(true);
  fresh.water!.ops.util[0]=12;
  expect(privateStudy).toEqual(original);
 });
 it('keeps edited raw-land studies out of fresh public starters',()=>{
  const privateStudy=createRawLandStarter(id,'Private synthetic land');
  privateStudy.region='Private synthetic location';
  privateStudy.rawLand!.site.areaAfterPriorTransfers=987654;
  privateStudy.rawLand!.sales.mix[0].name='Private synthetic use';
  privateStudy.legal[0].notes='Private synthetic appraisal';
  const original=structuredClone(privateStudy);
  const fresh=createRawLandStarter('another-land-study','New public land study');
  expect(fresh.region).toBe('');
  expect(fresh.rawLand!.site.areaAfterPriorTransfers).toBe(0);
  expect(fresh.rawLand!.sales.mix.some(use=>use.name==='Private synthetic use')).toBe(false);
  expect(fresh.legal.every(item=>item.notes==='')).toBe(true);
  fresh.rawLand!.sales.mix[0].name='Changed public starter';
  expect(privateStudy).toEqual(original);
 });
});
