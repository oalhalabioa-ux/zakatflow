import {describe,it,expect} from 'vitest';
import {createStudy,evaluateStudy} from './engine';
import {createWaterModel,evaluateWater} from './water-model';
import {createRawLand,evaluateRawLand} from './raw-land';
import {feasibilityDraftSchema} from './draft-schema';
import {parseStudyBackup,FEASIBILITY_BACKUP_SCHEMA} from './local-drafts';
import {studyProfileValues,studyProfilePatch} from './study-profile';

const id='6357a708-bae2-4634-9296-490404b1d8a4';
describe('single-source Royal profile inputs',()=>{
 it('preserves old drafts, validates optional metadata and round-trips JSON without authorizing access',()=>{
  const study=createStudy(id,'Synthetic profile','SERVICES');
  expect(studyProfileValues(study)).toMatchObject({area:0,startYear:undefined,years:5});
  expect(feasibilityDraftSchema.parse(study).projectStartYear).toBeUndefined();
  const next={...study,...studyProfilePatch(study,{area:900,startYear:2031,years:9}),studyType:'EXPANSION' as const};
  expect(feasibilityDraftSchema.parse(next)).toEqual(next);
  expect(parseStudyBackup({schema:FEASIBILITY_BACKUP_SCHEMA,studies:[next]})).toEqual([next]);
  for(const patch of [{projectStartYear:1899},{projectStartYear:2201},{siteAreaM2:-1},{studyType:'FORGED'},{owner_user_id:id}])
   expect(feasibilityDraftSchema.safeParse({...next,...patch}).success).toBe(false);
  expect(study.projectStartYear).toBeUndefined();
 });
 it('changes water area/horizon in the existing model without losing utilization assumptions or duplicating land',()=>{
  const study={...createStudy(id,'Synthetic water'),water:createWaterModel()};
  study.water.ops.util=[10,20,30,40,50,60,70,80,90,100];
  study.water.deal.landValue=24000;
  const before=structuredClone(study);
  const patch=studyProfilePatch(study,{area:6000,startYear:2030,years:4})!;
  const next={...study,...patch};
  expect(studyProfileValues(next)).toMatchObject({area:6000,startYear:2030,years:4});
  expect(next.siteAreaM2).toBeUndefined();expect(next.years).toBe(study.years);
  expect(next.water.ops.util).toEqual(before.water.ops.util);
  expect(evaluateWater(next.water)).toEqual(evaluateWater({...study.water,deal:{...study.water.deal,landArea:6000},ops:{...study.water.ops,horizon:4}}));
  expect(study).toEqual(before);
  expect(studyProfilePatch(study,{years:2})).toBeNull();
  expect(studyProfilePatch(study,{years:11})).toBeNull();
 });
 it('uses the raw-land canonical calendar/area/duration and retains cost and collection phasing',()=>{
  const study={...createStudy(id,'Synthetic land','REAL_ESTATE'),rawLand:createRawLand()};
  study.rawLand.site.areaAfterPriorTransfers=1000;
  study.rawLand.site.landPricePerNetSqm=10;
  study.rawLand.sales.mix[0].price=100;
  const before=structuredClone(study),patch=studyProfilePatch(study,{area:2000,startYear:2032,years:6})!;
  const next={...study,...patch};
  expect(studyProfileValues(next)).toMatchObject({area:2000,startYear:2032,years:6});
  expect(next.projectStartYear).toBeUndefined();expect(next.siteAreaM2).toBeUndefined();
  expect(next.rawLand.phasing).toEqual(before.rawLand.phasing);
  expect(evaluateRawLand(next.rawLand)).toEqual(evaluateRawLand({...study.rawLand,
   project:{...study.rawLand.project,startYear:2032,years:6},site:{...study.rawLand.site,areaAfterPriorTransfers:2000}}));
  expect(study).toEqual(before);
  expect(studyProfilePatch(study,{startYear:null})).toBeNull();
  expect(studyProfilePatch(study,{years:16})).toBeNull();
 });
 it('does not alter general financial results for descriptive area/year metadata and retains scheduled stages',()=>{
  const study=createStudy(id,'Synthetic general');
  study.sectorSchedule={kind:'INDUSTRIAL',ratedCapacityMonthly:1000,operatingMonths:12,utilizationPct:70,saleableYieldPct:90,productionCashCostPerGrossUnit:2};
  const next={...study,...studyProfilePatch(study,{area:8000,startYear:2030})};
  expect(evaluateStudy(next)).toEqual(evaluateStudy(study));
  expect(next.sectorSchedule).toEqual(study.sectorSchedule);
  for(const change of [{area:NaN},{area:Infinity},{area:-1},{years:2.5},{years:21},{startYear:2201}])
   expect(studyProfilePatch(study,change)).toBeNull();
  expect(studyProfileValues({...study,...studyProfilePatch(study,{years:20})}).years).toBe(20);
 });
});
