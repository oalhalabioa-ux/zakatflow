import type {FinancialSetupMode,FinancialSetupStep} from './financial-setup-steps';
import type {FinancialSetupReadiness} from './financial-setup-readiness';
export const SETUP_GROUPS=[
 {id:'organization',steps:['organization','structure'],ar:'المؤسسة أولًا',en:'Organization first',helpAr:'بيانات المؤسسة الأساسية',helpEn:'Organization profile'},
 {id:'regulatory',steps:['regulatory'],ar:'البيانات النظامية والضريبية',en:'Legal & tax',helpAr:'التسجيل والعنوان والفوترة',helpEn:'Registration, address and invoicing'},
 {id:'chart',steps:['chart','fiscal','posting','banking','opening'],ar:'التأسيس المالي',en:'Financial setup',helpAr:'الإعدادات المالية والمحاسبية',helpEn:'Finance and accounting'},
 {id:'users',steps:['users'],ar:'الفريق والصلاحيات',en:'Team & access',helpAr:'المالك والمستخدمون والأدوار',helpEn:'Owner, members and roles'},
 {id:'review',steps:['review'],ar:'المراجعة والجاهزية',en:'Review & readiness',helpAr:'مراجعة شاملة قبل التشغيل',helpEn:'Final setup review'},
] as const;
export type SetupGroup=typeof SETUP_GROUPS[number];
export type SetupGroupState='COMPLETE'|'REVIEWED'|'IN_PROGRESS'|'MISSING'|'CHECKING';
export function setupGroupState(group:SetupGroup,readiness:FinancialSetupReadiness|null,mode:FinancialSetupMode|null,reviewed:readonly FinancialSetupStep[],country?:string|null):SetupGroupState{
 if(!readiness)return 'CHECKING';
 if(group.id==='organization')return mode&&country&&readiness.statuses.organization==='READY'?'COMPLETE':'MISSING';
 if(group.id==='regulatory')return reviewed.includes('regulatory')?'REVIEWED':'MISSING';
 if(group.id==='review')return readiness.ready&&country&&reviewed.includes('review')?'REVIEWED':readiness.ready&&country?'IN_PROGRESS':'MISSING';
 // A verified zero opening is a ready financial source even when the UI labels
 // entering historical balances optional. Local review never substitutes proof.
 const statuses=group.steps.map(id=>readiness.statuses[id]);
 return statuses.every(s=>s==='READY')?'COMPLETE':statuses.some(s=>s==='READY'||s==='IN_PROGRESS')?'IN_PROGRESS':'MISSING';
}
