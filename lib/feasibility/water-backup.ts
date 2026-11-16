import {z} from 'zod';
import {createStudy} from './engine';
import {feasibilityDraftSchema} from './draft-schema';
import {waterModelSchema} from './water-model';

const text=z.string().max(5000);
const id=z.string().min(1).max(100);
const date=z.string().max(30);
const amount=z.number().finite().min(0).max(1e12);
const riskScore=z.number().int().min(1).max(5);
const legacyWaterSchema=waterModelSchema.extend({
 version:z.literal(1),
 meta:z.object({name:text,region:text,owner:text,asof:date,notes:text}).strict(),
 legal:z.array(z.object({id,title:text,group:text,critical:z.boolean(),desc:text,assignee:text,due:date,evidence:text,
  status:z.enum(['pending','review','blocked','done'])}).strict()).max(500),
 tasks:z.array(z.object({id,title:text,phase:text,priority:z.enum(['عالية','متوسطة','منخفضة']),owner:text,due:date,note:text,
  status:z.enum(['todo','doing','blocked','done'])}).strict()).max(500),
 risks:z.array(z.object({id,title:text,category:text,impact:riskScore,likelihood:riskScore,mitigation:text,owner:text,
  status:z.enum(['open','mitigated'])}).strict()).max(500),
 quotes:z.array(z.object({id,vendor:text,category:text,amount,capacity:amount,lead:amount,warranty:text,note:text,
  status:z.enum(['new','review','selected','rejected'])}).strict()).max(500),
 decisions:z.array(z.object({id,date,title:text,detail:text,owner:text,status:z.enum(['open','agreed','done'])}).strict()).max(500),
 ui:z.object({tab:z.string().max(40)}).strict().optional()
}).strict();

const taskStatuses={todo:'TODO',doing:'IN_PROGRESS',blocked:'BLOCKED',done:'DONE'} as const;
const priorities={'عالية':'HIGH','متوسطة':'NORMAL','منخفضة':'LOW'} as const;
const legalStatuses={pending:'NOT_STARTED',review:'UNDER_REVIEW',blocked:'BLOCKED',done:'VERIFIED'} as const;
const riskStatuses={open:'OPEN',mitigated:'MITIGATED'} as const;
const offerStatuses={new:'NEW',review:'REVIEW',selected:'SELECTED',rejected:'REJECTED'} as const;
const decisionStatuses={open:'OPEN',agreed:'AGREED',done:'DONE'} as const;

export function importWaterBackup(input:unknown,newStudyId:string){
 const parsed=legacyWaterSchema.safeParse(input);
 if(!parsed.success)return null;
 const {meta,deal,capex,ops,scenarios,legal,tasks,risks,quotes,decisions}=parsed.data;
 for(const rows of [legal,tasks,risks,quotes,decisions]){
  if(new Set(rows.map(row=>row.id)).size!==rows.length)return null;
 }
 const study={
  ...createStudy(newStudyId,meta.name),
  country:'SY',region:meta.region,currency:'USD',preparedBy:meta.owner,studyDate:meta.asof,notes:meta.notes,
  status:'FEASIBILITY',water:{deal,capex,ops,scenarios},
  legal:legal.map(({id,title,group,critical,desc,assignee,due,evidence,status})=>({
   id,title,group,critical,description:desc,owner:assignee,due,notes:evidence,status:legalStatuses[status]
  })),
  tasks:tasks.map(({id,title,phase,priority,owner,due,note,status})=>({
   id,title,phase,priority:priorities[priority],owner,due,notes:note,status:taskStatuses[status]
  })),
  risks:risks.map(({id,title,category,impact,likelihood,mitigation,owner,status})=>({
   id,title,category,impact,likelihood,response:mitigation,owner,status:riskStatuses[status]
  })),
  suppliers:quotes.map(({id,vendor,category,amount,capacity,lead,warranty,note,status})=>({
   id,vendor,item:category,offer:amount,capacity,leadDays:lead,warranty,notes:note,status:offerStatuses[status]
  })),
  decisions:decisions.map(({id,date,title,detail,owner,status})=>({
   id,date,title,notes:detail,owner,status:decisionStatuses[status]
  }))
 };
 const checked=feasibilityDraftSchema.safeParse(study);
 return checked.success?checked.data:null;
}
