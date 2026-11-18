import {z} from 'zod';
import {feasibilityDraftSchema} from './draft-schema';
import {createRawLandStarter} from './project-templates';
import {rawLandSchema} from './raw-land';

const fields=rawLandSchema.shape;
const salesFields=fields.sales.shape;
const reference=fields.legacyReference.unwrap().shape;
const phase=fields.phasing.shape.sales;
const legalStatus={
 'لم يبدأ':'NOT_STARTED',
 'قيد المراجعة':'UNDER_REVIEW',
 'مكتمل':'VERIFIED',
 'متعثر':'BLOCKED'
} as const;
const score=z.number().int().min(1).max(5);

const legacyLandSchema=z.object({
 meta:z.object({product:z.literal('Yaqeen Business'),modelVersion:z.literal('1.0')}),
 project:fields.project.extend({
  name:z.string().trim().min(1).max(300),country:z.string().trim().max(120),city:z.string().max(150),
  currency:z.string().regex(/^(?:[A-Z]{3})?$/),structure:reference.structure.optional(),
  sourceNotes:z.string().max(5000).optional(),timelinePeriod:z.literal('annual').optional()
 }).strip(),
 site:fields.site.omit({valuationDate:true,appraiser:true}).strip(),
 cost:fields.cost.omit({developmentItems:true}).strip(),
 finance:fields.finance.extend({loanDrawFirstYear:fields.finance.shape.loanDrawFirstYear.optional()}).strip(),
 sales:z.object({
  priceMode:salesFields.priceMode,
  mix:z.array(salesFields.mix.element.omit({salesPhasing:true,collectionPhasing:true}).extend({
   absorption:phase.optional()
  }).strip()).max(20),
  scenarioMultipliers:z.array(salesFields.scenarios.element.extend({
   key:z.string().trim().min(1).max(100)
  }).strip()).min(1).max(12)
 }),
 phasing:fields.phasing,
 waterfall:fields.waterfall.strip(),
 partners:reference.partners.optional(),
 developmentAllocation:reference.developmentAllocation.optional(),
 legalChecklist:z.array(z.object({
  group:z.string().max(5000),task:z.string().max(500),status:z.enum(Object.keys(legalStatus) as (keyof typeof legalStatus)[]),
  owner:z.string().max(5000),source:z.string().max(5000)
 })).max(500).optional(),
 riskRegister:z.array(z.object({
  risk:z.string().max(500),prob:score,impact:score,mitigation:z.string().max(5000),owner:z.string().max(5000)
 })).max(500).optional()
});

export function importRawLandBackup(input:unknown,newStudyId:string){
 const parsed=legacyLandSchema.safeParse(input);
 if(!parsed.success)return null;
 const data=parsed.data;
 const {name,country,city,currency,sourceNotes,structure='',timelinePeriod:_,...project}=data.project;
 const {otherConstraintsSqm,...site}=data.site;
 const {priceMode,mix,scenarioMultipliers}=data.sales;
 if(new Set(scenarioMultipliers.map(scenario=>scenario.key)).size!==scenarioMultipliers.length)return null;

 const starter=createRawLandStarter(newStudyId,name);
 const checked=feasibilityDraftSchema.safeParse({
  ...starter,country,region:city,currency,notes:sourceNotes??'',
  rawLand:{
   project,
   // The 1.0 calculator used only flood and extra exclusions. Retain other constraints as reference.
   site:{...site,otherConstraintsSqm:0,valuationDate:'',appraiser:''},
   cost:data.cost,finance:{...data.finance,loanDrawFirstYear:data.finance.loanDrawFirstYear??.4},
   sales:{
    priceMode,mix:mix.map(({absorption:_,...use})=>use),
    scenarios:scenarioMultipliers.map(({key:_,...scenario})=>scenario)
   },
   phasing:data.phasing,waterfall:data.waterfall,
   legacyReference:{
    structure,additionalConstraints:otherConstraintsSqm,partners:data.partners??[],
    developmentAllocation:data.developmentAllocation??[],
    absorption:mix.flatMap(use=>use.absorption?[{name:use.name,phasing:use.absorption}]:[])
   }
  },
  legal:[...starter.legal,...(data.legalChecklist??[]).map((item,index)=>({
   id:'land-import-legal-'+index,title:item.task,group:item.group,owner:item.owner,
   status:legalStatus[item.status],notes:item.source
  }))],
  risks:data.riskRegister?.map((item,index)=>({
   id:'land-import-risk-'+index,title:item.risk,likelihood:item.prob,impact:item.impact,
   response:item.mitigation,owner:item.owner,status:'OPEN'
  }))??starter.risks
 });
 return checked.success?checked.data:null;
}
