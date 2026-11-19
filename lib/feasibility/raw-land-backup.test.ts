import {describe,expect,it} from 'vitest';
import {createRawLand,evaluateRawLand} from './raw-land';
import {importRawLandBackup} from './raw-land-backup';
import {appendImportedStudies,FEASIBILITY_BACKUP_SCHEMA,parseStudyBackup} from './local-drafts';
import {createRawLandStarter} from './project-templates';

const id='1a2b3c4d-1a2b-4c3d-8a2b-1a2b3c4d5e6f';
const copyId='2a2b3c4d-1a2b-4c3d-8a2b-1a2b3c4d5e6f';

function legacyFile(){
 const {project,site,cost,finance,sales,phasing,waterfall}=createRawLand();
 const {loanDrawFirstYear:_,...legacyFinance}=finance;
 return {
  meta:{product:'Yaqeen Business',modelVersion:'1.0'},
  project:{...project,name:'Example development',country:'SA',city:'Example city',currency:'SAR',timelinePeriod:'annual'},
  site:{...site,areaAfterPriorTransfers:2000,otherConstraintsSqm:100,landPricePerNetSqm:10},
  cost,finance:{...legacyFinance,facility:5000},
  sales:{priceMode:'reference',mix:[{...sales.mix[0],name:'Residential',price:25,absorption:[0,0,0,1]}],
   scenarioMultipliers:sales.scenarios.map((row,index)=>({...row,key:'scenario-'+index}))},
  phasing,waterfall,partners:[{name:'Sample partner',contributionType:'land',contribution:20000,profitShare:1,role:'owner'}],
  legalChecklist:[{group:'Planning',task:'Review zoning',status:'لم يبدأ',owner:'Team',source:'Municipality'}],
  riskRegister:[{risk:'Sales delay',prob:3,impact:4,mitigation:'Phase sales',owner:'Team'}]
 };
}

describe('legacy land study imports',()=>{
 it('preserves legacy financing defaults, forecast assumptions and separate reference data',()=>{
  const source=legacyFile();
  const snapshot=structuredClone(source);
  const study=importRawLandBackup(source,id)!;
  expect(study).toMatchObject({id,title:'Example development',region:'Example city',currency:'SAR',status:'IDEA'});
  expect(study.legal.at(-1)).toMatchObject({title:'Review zoning',status:'NOT_STARTED'});
  expect(study.legal.some(item=>item.critical&&item.status==='NOT_STARTED')).toBe(true);
  expect(study.risks[0]).toMatchObject({title:'Sales delay',likelihood:3,impact:4});
  expect(study.rawLand?.legacyReference).toMatchObject({
   additionalConstraints:100,partners:source.partners,absorption:[{name:'Residential',phasing:[0,0,0,1]}]
  });
  const result=evaluateRawLand(study.rawLand!);
  expect(result.net).toBe(2000);
  if(result.issue)throw Error(result.issue);
  expect(result.annual.map(year=>year.salesValue)).toEqual([12500,12500,12500,12500]);
  expect(result.annual[0].draw).toBe(2000);
  const existing=createRawLandStarter(id,'Untouched draft');
  const added=appendImportedStudies([existing],[study],()=>copyId)!;
  expect(added.studies).toEqual([expect.objectContaining({id:copyId}),existing]);
  expect(parseStudyBackup(JSON.parse(JSON.stringify({schema:FEASIBILITY_BACKUP_SCHEMA,studies:added.studies})))).toEqual(added.studies);
  expect(source).toEqual(snapshot);
 });

 it('rejects unsupported versions, duplicate scenario keys, and invalid values',()=>{
  const source=legacyFile();
  expect(importRawLandBackup({...source,meta:{...source.meta,modelVersion:'2.0'}},id)).toBeNull();
  expect(importRawLandBackup({...source,site:{...source.site,landPricePerNetSqm:-1}},id)).toBeNull();
  source.sales.scenarioMultipliers[1].key=source.sales.scenarioMultipliers[0].key;
  expect(importRawLandBackup(source,id)).toBeNull();
 });
});
