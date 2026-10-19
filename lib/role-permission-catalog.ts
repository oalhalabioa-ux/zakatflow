export type PermissionOption = { key: string; ar: string; en: string; arHelp: string; enHelp: string };
export const permissionGroups: { key: string; ar: string; en: string; arDescription: string; enDescription: string; permissions: PermissionOption[] }[] = [
 {key:'financial_core',ar:'الذمم والقروض والسلف والمحرك المالي',en:'Balances, Loans, Advances & Financial Core',arDescription:'الذمم المدينة والدائنة، الأرصدة الافتتاحية، الدفعات المقدمة، القروض والسلف',enDescription:'Receivables, payables, opening balances, advances and loan contracts',permissions:[
  {key:'financial_core.view',ar:'عرض الأحداث المالية',en:'View financial events',arHelp:'مشاهدة الأحداث والالتزامات المالية.',enHelp:'View financial events and obligations.'},
  {key:'financial_core.create',ar:'إنشاء وتعديل',en:'Create & edit',arHelp:'إنشاء الأحداث المالية وتجهيزها قبل الاعتماد.',enHelp:'Create and prepare financial events.'},
  {key:'financial_core.submit',ar:'إرسال للاعتماد',en:'Submit for approval',arHelp:'إرسال الحدث المالي إلى دورة الاعتماد.',enHelp:'Submit financial events for approval.'},
  {key:'financial_core.approve',ar:'اعتماد مالي',en:'Financial approval',arHelp:'اعتماد الأحداث المالية وفق سياسة الجهة.',enHelp:'Approve financial events under organization policy.'},
  {key:'financial_core.post',ar:'ترحيل مالي',en:'Post financial events',arHelp:'تحويل الحدث المعتمد إلى فعلي.',enHelp:'Post approved events as actual.'},
  {key:'financial_core.reverse',ar:'عكس عملية مالية',en:'Reverse financial events',arHelp:'عكس العمليات المالية دون حذف أثرها الرقابي.',enHelp:'Reverse financial events with audit trail.'},
  {key:'financial_core.self_approve',ar:'اعتماد العملية الذاتية',en:'Self-approval',arHelp:'صلاحية حساسة؛ تسمح باعتماد عملية أنشأها المستخدم فقط عندما تسمح سياسة الاعتماد.',enHelp:'Sensitive: approve own event only when approval policy allows it.'},
 ]},
 {key:'liquidity',ar:'السيولة والخزينة',en:'Cash & Treasury',arDescription:'الحسابات والتدفقات والسداد النقدي',enDescription:'Accounts, cash flows, and settlement',permissions:[
  {key:'liquidity.view',ar:'عرض السيولة',en:'View liquidity',arHelp:'مشاهدة الحسابات والتدفقات والأرصدة.',enHelp:'View accounts, flows, and balances.'},
  {key:'liquidity.edit',ar:'إدارة السيولة',en:'Manage liquidity',arHelp:'إضافة وتعديل بيانات السيولة.',enHelp:'Create and edit liquidity records.'},
  {key:'liquidity.settle',ar:'تنفيذ السداد',en:'Settle payments',arHelp:'صلاحية حساسة لتنفيذ السداد الفعلي على الحسابات النقدية.',enHelp:'Sensitive permission to post actual cash settlements.'},
 ]},
 {key:'assets',ar:'الأصول والاستثمارات',en:'Assets & Investments',arDescription:'الأصول والودائع والسندات والصكوك؛ الاعتماد والسداد يتطلبان صلاحيات مالية إضافية',enDescription:'Assets, deposits, bonds and sukuk; approval and settlement need financial permissions',permissions:[
  {key:'assets.view',ar:'عرض الأصول',en:'View assets',arHelp:'مشاهدة الأصول والاستثمارات وتقاريرها حسب نطاق الجهة.',enHelp:'View assets, investments and their reports within organization scope.'},
  {key:'assets.edit',ar:'إدارة الأصول',en:'Manage assets',arHelp:'إضافة وتعديل الأصول وعقود الاستثمار؛ لا تمنح وحدها اعتمادًا أو سدادًا ماليًا.',enHelp:'Manage asset and investment contracts; does not independently grant financial approval or settlement.'},
 ]},
 {key:'budget',ar:'الموازنة والتخطيط',en:'Budget & Planning',arDescription:'إعداد الموازنة وإرسالها واعتمادها',enDescription:'Prepare, submit, and approve budgets',permissions:[
  {key:'budget.view',ar:'عرض الموازنة',en:'View budget',arHelp:'مشاهدة خطط وتقارير الموازنة.',enHelp:'View budget plans and reports.'},
  {key:'budget.edit',ar:'إعداد وتعديل الموازنة',en:'Edit budget',arHelp:'إدخال وتعديل بيانات الموازنة.',enHelp:'Prepare and edit budget data.'},
  {key:'budget.submit',ar:'إرسال الموازنة للاعتماد',en:'Submit budget',arHelp:'إرسال الموازنة إلى دورة الاعتماد.',enHelp:'Submit a budget for approval.'},
  {key:'budget.approve',ar:'اعتماد الموازنة',en:'Approve budget',arHelp:'صلاحية حساسة لاعتماد الموازنة.',enHelp:'Sensitive permission to approve budgets.'},
 ]},
 {key:'vat',ar:'الضريبة والفوترة',en:'VAT & Invoicing',arDescription:'ضريبة القيمة المضافة وفواتير البيع والشراء',enDescription:'VAT and sales/purchase invoices',permissions:[
  {key:'vat.view',ar:'عرض البيانات',en:'View data',arHelp:'مشاهدة الملفات والسجلات الضريبية.',enHelp:'View tax profiles and records.'},
  {key:'vat.edit',ar:'إدارة البيانات والفواتير',en:'Manage records & invoices',arHelp:'إنشاء وتعديل السجلات والفواتير.',enHelp:'Create and edit records and invoices.'},
  {key:'vat.issue',ar:'إصدار الفواتير الإلكترونية',en:'Issue e-invoices',arHelp:'اعتماد وإصدار الفواتير الإلكترونية.',enHelp:'Finalize and issue electronic invoices.'},
 ]},
 {key:'zakat',ar:'الزكاة',en:'Zakat',arDescription:'بيانات واحتسابات الزكاة',enDescription:'Zakat data and assessments',permissions:[
  {key:'zakat.view',ar:'عرض الزكاة',en:'View zakat',arHelp:'مشاهدة بيانات واحتسابات الزكاة.',enHelp:'View zakat data and assessments.'},
  {key:'zakat.edit',ar:'إدارة الزكاة',en:'Manage zakat',arHelp:'إنشاء وتعديل بيانات الزكاة.',enHelp:'Create and edit zakat data.'},
 ]},
 {key:'audit',ar:'المراجعة والرقابة',en:'Audit & Controls',arDescription:'سجل التدقيق والرقابة المالية',enDescription:'Audit trail and financial controls',permissions:[
  {key:'audit.view',ar:'عرض سجل التدقيق',en:'View audit trail',arHelp:'مشاهدة سجل التدقيق والعمليات الرقابية.',enHelp:'View audit and control records.'},
 ]},
 {key:'organization',ar:'المنشأة',en:'Organization',arDescription:'الهيكل والكيانات ومراكز التكلفة',enDescription:'Structure, entities, and cost centers',permissions:[
  {key:'organization.edit',ar:'إدارة بيانات المنشأة',en:'Manage organization data',arHelp:'تعديل بيانات المنشأة والهيكل بحسب ضوابط الوحدة؛ إدارة المستخدمين تبقى للمالك والمسؤول.',enHelp:'Edit organization structure under module controls; user administration remains owner/admin only.'},
  {key:'organization.view',ar:'عرض بيانات المنشأة',en:'View organization',arHelp:'مشاهدة الهيكل وبيانات المنشأة.',enHelp:'View organization structure and data.'},
 ]},
];

export const permissionOptions = permissionGroups.flatMap(group => group.permissions);
export const permissionKeys = new Set(permissionOptions.map(item => item.key));
export const permissionDependencies: Record<string, string[]> = {
 'financial_core.create':['financial_core.view'], 'financial_core.submit':['financial_core.create'],
 'financial_core.approve':['financial_core.view'], 'financial_core.post':['financial_core.approve'],
 'financial_core.reverse':['financial_core.post'], 'financial_core.self_approve':['financial_core.approve'],
 'liquidity.edit':['liquidity.view'], 'liquidity.settle':['liquidity.view'],
 'assets.edit':['assets.view'], 'budget.edit':['budget.view'], 'budget.submit':['budget.edit'],
 'budget.approve':['budget.view'], 'vat.edit':['vat.view'], 'vat.issue':['vat.edit'],
 'zakat.edit':['zakat.view'], 'organization.edit':['organization.view']
};
export function normalizeRolePermissions(values: string[]): string[] {
 const result = new Set(values);
 let changed = true;
 while(changed){changed=false;for(const key of [...result])for(const prerequisite of permissionDependencies[key] ?? [])if(!result.has(prerequisite)){result.add(prerequisite);changed=true;}}
 return [...result];
}
export function toggleRolePermission(values:string[],key:string,checked:boolean):string[]{
 if(checked)return normalizeRolePermissions([...values,key]);
 const removed=new Set([key]); let changed=true;
 while(changed){changed=false;for(const [permission,dependencies] of Object.entries(permissionDependencies))if(!removed.has(permission)&&dependencies.some(d=>removed.has(d))){removed.add(permission);changed=true;}}
 return values.filter(value=>!removed.has(value));
}
export const rolePresets = [
 {id:'balances',ar:'مسؤول الذمم والقروض والسلف',en:'Balances, loans & advances officer',permissions:['organization.view','financial_core.view','financial_core.create','financial_core.submit','liquidity.view']},
 {id:'treasury',ar:'مسؤول الخزينة والتنفيذ',en:'Treasury & settlement officer',permissions:['organization.view','financial_core.view','financial_core.create','financial_core.submit','financial_core.post','liquidity.view','liquidity.edit','liquidity.settle']},
 {id:'investments',ar:'مسؤول الأصول والاستثمارات',en:'Assets & investments officer',permissions:['organization.view','assets.view','assets.edit','financial_core.view','financial_core.create','financial_core.submit','liquidity.view']},
 {id:'reviewer',ar:'مراجع مالي للقراءة',en:'Read-only financial reviewer',permissions:['organization.view','financial_core.view','liquidity.view','assets.view','vat.view','budget.view','zakat.view','audit.view']},
 {id:'planning',ar:'مسؤول التخطيط والموازنة',en:'Planning & budget officer',permissions:['organization.view','financial_core.view','liquidity.view','budget.view','budget.edit','budget.submit']},
 {id:'tax',ar:'مسؤول الضريبة والزكاة',en:'Tax & zakat officer',permissions:['organization.view','financial_core.view','vat.view','vat.edit','vat.issue','zakat.view','zakat.edit']},
];
export const moduleCoverage = [
 {ar:'الذمم المدينة والدائنة والتقارير',en:'Receivables, payables & reports',keys:['financial_core.view']},
 {ar:'الأرصدة الافتتاحية والقروض والسلف',en:'Opening balances, loans & employee advances',keys:['financial_core.view','financial_core.create','financial_core.submit']},
 {ar:'القبض والسداد والدفعات المقدمة',en:'Receipts, payments & advances',keys:['financial_core.view','financial_core.create','liquidity.edit','liquidity.settle']},
 {ar:'الودائع والسندات والصكوك',en:'Deposits, bonds & sukuk',keys:['assets.view','assets.edit']},
 {ar:'الاعتماد والترحيل والعكس',en:'Approval, posting & reversal',keys:['financial_core.approve','financial_core.post','financial_core.reverse']},
];
