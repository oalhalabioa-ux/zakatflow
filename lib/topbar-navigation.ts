import {isSettingsPage} from '../components/settings/navigation';
export type WorkspaceScope='PERSONAL'|'ORGANIZATION';
export const isFinancialReportingPage=(path:string)=>['financial-reports','opening-balances','opening-balances/branches','opening-balances/centers','financial-reporting-policy','chart-of-accounts'].includes(path);
const shared=new Set(['settings/system','account','notifications','guide','governance']);
export const isSharedWorkspacePage=(path:string)=>shared.has(path);
const scoped=new Set([...shared,'liquidity','vat','invoice-register','payments','assessments','transactions','lots','debt-collection','loans','debt-advances','dashboard','debts','cash-and-banks','receivables','payables','debt-report','financial-position','assets/dashboard','assets','investments','reports','reports/print','financial-reports','feasibility','prices','workflow','enterprise']);
export const isWorkspaceScopeDetail=(path:string)=>/^(transactions|lots)\/[^/]+$/.test(path);
export const isWorkspaceScopePage=(path:string)=>scoped.has(path)||isWorkspaceScopeDetail(path);
export const workspaceScopeStorageKey='zf-workspace-scope';
export function rememberedWorkspaceScope():WorkspaceScope|undefined{try{const s=sessionStorage.getItem(workspaceScopeStorageKey);return s==='PERSONAL'||s==='ORGANIZATION'?s:undefined}catch{return undefined}}
export function rememberWorkspaceScope(scope:WorkspaceScope){try{sessionStorage.setItem(workspaceScopeStorageKey,scope)}catch{}}
export const isClientWorkspaceScope=(path:string)=>isWorkspaceScopePage(path)&&!isWorkspaceScopeDetail(path)&&!['liquidity','vat','invoice-register','dashboard','financial-reports','reports/print','enterprise'].includes(path);
export function currentWorkspaceScope(path:string,query:string,remembered?:WorkspaceScope):WorkspaceScope{
 if(path==='settings/personal-setup')return 'PERSONAL';
 const q=new URLSearchParams(query),value=q.get('scope');
 if(isWorkspaceScopePage(path)){
  if(value==='PERSONAL'||value==='ORGANIZATION')return value;
  if(remembered)return remembered;
 }
 if(path==='feasibility/shared'||path==='feasibility/shared/review'||(isSettingsPage(path)&&!shared.has(path))||(isFinancialReportingPage(path)&&path!=='financial-reports')||path==='preview/fiscal-years')return 'ORGANIZATION';
 return ['qard-loans','debt-collection','employee-advances','debt-advances','debt-openings','payables','vat','liquidity','loans','budget-planning','organizations','users','billing','onboarding','financial-reports'].includes(path)?'ORGANIZATION':'PERSONAL';
}
/** Organizational selection is never part of a personal or account-wide URL. */
export function clearOrganizationScopeQuery(query:URLSearchParams){
 for(const key of ['organization','organization_id','level','entity','entity_id','branch','branch_id','cost_center','cost_center_id','center','center_id'])query.delete(key);
}
export function workspaceScopeHref(locale:string,path:string,query:string,scope:WorkspaceScope){
 const stay=isWorkspaceScopePage(path)||(isFinancialReportingPage(path)&&scope==='ORGANIZATION');
 const setup=path==='settings/financial/setup'||path==='settings/personal-setup';
 const previous=new URLSearchParams(query).get('scope');
 const leavingDetail=isWorkspaceScopeDetail(path)&&(previous==='PERSONAL'||previous==='ORGANIZATION')&&previous!==scope;
 const target=leavingDetail?path.split('/')[0]:setup?(scope==='PERSONAL'?'settings/personal-setup':'settings/financial/setup'):stay?path:'dashboard';
 const q=new URLSearchParams(stay||setup?query:'');q.set('scope',scope);
 if(scope==='PERSONAL'||shared.has(target))clearOrganizationScopeQuery(q);
 if((path==='vat'||path==='invoice-register')&&scope==='PERSONAL')q.delete('document_id');
 if(path==='financial-reports'&&scope==='PERSONAL')q.delete('screen');
 return '/'+locale+'/'+target+'?'+q;
}
export const navigationItems=[
 ['dashboard','اللوحة الرئيسية','Dashboard','الرئيسية نظرة عامة مؤشرات'],['assets','الأصول','Assets','شراء اصل عقارات ذهب فضة مخزون'],['cash-and-banks','النقد والبنوك','Cash & banks','حساب صندوق بنك نقدية'],['receivables','الذمم المدينة','Receivables','عميل عملاء تحصيل مدين'],['payables','الذمم الدائنة','Payables','مورد موردين سداد دائن'],['debt-report','تقرير الذمم الموحد','Debt report','ارصدة أرصدة كشف حساب'],['debts','الذمم والتمويل','Receivables & financing','نظرة عامة ارصدة التزامات'],['loans','القروض','Loans','قرض اقساط أقساط تمويل'],['employee-advances','سلف الموظفين','Employee advances','سلفة موظف استقطاع'],['debt-advances','الدفعات المقدمة','Advance payments','دفعة مورد عميل مقدم'],['debt-collection','الاستحقاقات والمتابعة','Due dates & follow-up','تحصيل سداد متابعة اقساط أعمار رواتب استقطاع'],['debt-openings','سندات الأرصدة الافتتاحية','Opening balance vouchers','رصيد افتتاحي'],['investments','الاستثمارات','Investments','وديعة ودائع سندات اسهم أسهم صناديق عوائد'],['transactions','العمليات','Transactions','معاملات شراء بيع تحويل'],['assessments','احتساب الزكاة','Zakat assessment','زكاة حول نصاب'],['payments','دفعات الزكاة','Zakat payments','زكاة مدفوعات'],['reports','تقارير الأصول','Asset reports','تقرير اصول أصول'],['liquidity?tab=calendar','التقويم النقدي','Cash calendar','سيولة تدفقات قبض دفع'],['liquidity?tab=forecast','توقعات السيولة','Cash forecast','سيولة توقعات تدفقات'],['liquidity?tab=transfers','التحويلات','Transfers','تحويل بنك بنوك'],['liquidity?tab=counterparties','الجهات والتقارير','Parties & reports','جهة عميل مورد'],['vat?section=invoices','سجل الفواتير','Invoices','فاتورة فواتير مبيعات مشتريات'],['vat?section=unified','سجل الفواتير الموحد','Unified invoices','فواتير اصول أصول موحد'],['vat?section=reports','التقارير المالية','Financial reports','ايرادات إيرادات مصاريف مبيعات مشتريات'],['vat?section=dashboard','ضريبة القيمة المضافة','VAT','ضريبة ضرائب قيمة مضافة'],['vat?section=einvoicing','الفوترة الإلكترونية وزاتكا','E-invoicing & ZATCA','فاتورة زاتكا فواتير'],['budget-planning','التخطيط المالي والموازنات','Budget planning','موازنة ميزانية تخطيط توقعات'],['organizations','الهيكل المؤسسي','Organizations','شركة شركات فروع مركز مشروع'],['users','المستخدمون والصلاحيات','Users & permissions','مستخدم صلاحيات اعضاء أعضاء'],['prices','الأسعار والعملات','Prices & FX','عملة صرف سعر ذهب فضة'],['notifications','الإشعارات','Notifications','اشعار تنبيه تنبيهات'],['guide','الدليل والمساعدة','Guide & help','مساعدة دليل شرح'],['settings/financial/fiscal-years','إدارة السنوات المالية','Fiscal year management','سنة مالية تقويم بداية نهاية اغلاق إقفال إعدادات محاسبية'],['settings','إعدادات المؤسسة','Organization settings','اعدادات إعدادات شركة مؤسسة'],['settings/system','إعدادات النظام','System settings','اعدادات إعدادات نظام عملة'],['billing','الاشتراك والباقات','Subscription & plans','اشتراك باقة باقات تجربة ترقية'],['account','حسابي','My account','حساب تفضيلات لغة تقويم نصاب']
] as const;
const normalize=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').trim();
export function searchNavigation(query:string){const words=normalize(query).split(/\s+/).filter(Boolean);if(!words.length)return [];return navigationItems.map((item,i)=>({item,i,score:words.every(w=>normalize(item.slice(1).join(' ')).includes(w))?words.reduce((n,w)=>n+(normalize(item[1]).includes(w)||normalize(item[2]).includes(w)?3:1),0):0})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,8).map(r=>r.item);}
export function navigationHref(locale:string,path:string,scope:WorkspaceScope){const [page,query='']=path.split('?'),q=new URLSearchParams(query);if(isWorkspaceScopePage(page))q.set('scope',scope);return '/'+locale+'/'+page+(q.size?'?'+q:'');}
