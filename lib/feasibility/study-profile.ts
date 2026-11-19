import type {FeasibilityStudy,StudyType} from './engine';

export const studyTypeLabels:Record<StudyType,{ar:string;en:string}>={
 NEW_PROJECT:{ar:'دراسة جديدة',en:'New project'},EXPANSION:{ar:'توسعة',en:'Expansion'},
 ACQUISITION:{ar:'شراء مشروع',en:'Acquisition'},
};

/** Read and edit the specialized model's existing inputs, never shadow copies. */
export function studyProfileValues(study:FeasibilityStudy){
 return {
  area:study.water?.deal.landArea??study.rawLand?.site.areaAfterPriorTransfers??study.siteAreaM2??0,
  startYear:study.rawLand?.project.startYear??study.projectStartYear,
  years:study.water?.ops.horizon??study.rawLand?.project.years??study.years,
  minYears:study.water?3:1,maxYears:study.water?10:study.rawLand?15:20,
 };
}

type ProfileChange={area?:number;startYear?:number|null;years?:number};
export function studyProfilePatch(study:FeasibilityStudy,change:ProfileChange):Partial<FeasibilityStudy>|null{
 const {minYears,maxYears}=studyProfileValues(study);
 if(change.area!==undefined&&(!Number.isFinite(change.area)||change.area<0||change.area>1e12))return null;
 if(change.years!==undefined&&(!Number.isInteger(change.years)||change.years<minYears||change.years>maxYears))return null;
 if(change.startYear!==undefined&&change.startYear!==null&&
  (!Number.isInteger(change.startYear)||change.startYear<1900||change.startYear>2200))return null;
 // Raw land already requires its calendar year; clearing it cannot silently assign a new one.
 if(study.rawLand&&change.startYear===null)return null;
 if(study.water){
  return {
   water:{...study.water,deal:{...study.water.deal,...(change.area===undefined?{}:{landArea:change.area})},
    ops:{...study.water.ops,...(change.years===undefined?{}:{horizon:change.years})}},
   ...(change.startYear===undefined?{}:{projectStartYear:change.startYear??undefined}),
  };
 }
 if(study.rawLand){
  return {rawLand:{...study.rawLand,
   site:{...study.rawLand.site,...(change.area===undefined?{}:{areaAfterPriorTransfers:change.area})},
   project:{...study.rawLand.project,...(change.years===undefined?{}:{years:change.years}),
    ...(change.startYear==null?{}:{startYear:change.startYear})},
  }};
 }
 return {...(change.area===undefined?{}:{siteAreaM2:change.area}),
  ...(change.years===undefined?{}:{years:change.years}),
  ...(change.startYear===undefined?{}:{projectStartYear:change.startYear??undefined})};
}
