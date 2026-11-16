/**
 * Account-numbering proposals, not a second chart or a posting engine.
 * Every six-digit entry is a child of a canonical four-digit control account.
 * The same code always has the same meaning in every organization.
 */
export const FINANCIAL_INDUSTRIES = [
  {id:'GENERAL',ar:'تجاري',en:'Trading'},
  {id:'SERVICES',ar:'خدمي',en:'Services'},
  {id:'REAL_ESTATE',ar:'عقاري',en:'Real estate'},
  {id:'INVESTMENTS',ar:'استثمارات',en:'Investments'},
  {id:'HEALTH',ar:'صحي',en:'Healthcare'},
  {id:'EDUCATION',ar:'تعليمي',en:'Education'},
] as const;

export type FinancialIndustry = typeof FINANCIAL_INDUSTRIES[number]['id'];
export type FinancialAccountTemplate = {
  code:string;
  parentCode:string;
  nameAr:string;
  nameEn:string;
  normalSide:'DEBIT'|'CREDIT';
  source:'CORE'|FinancialIndustry;
};

const core = [
  ['150001','أثاث وتجهيزات','Furniture & fixtures','DEBIT'],
  ['150002','أجهزة ومعدات مكتبية','Office equipment','DEBIT'],
  ['159001','مجمع إهلاك الأثاث والتجهيزات','Accumulated depreciation – furniture','CREDIT'],
  ['159002','مجمع إهلاك الأجهزة والمعدات','Accumulated depreciation – equipment','CREDIT'],
  ['610001','رواتب وأجور','Salaries & wages','DEBIT'],
  ['610002','إيجارات تشغيلية','Operating rent','DEBIT'],
  ['610003','كهرباء ومياه واتصالات','Utilities & communications','DEBIT'],
  ['610004','أتعاب مهنية','Professional fees','DEBIT'],
  ['620001','مصروف الإهلاك','Depreciation expense','DEBIT'],
  ['710001','تكاليف تمويل بنكية','Bank financing costs','DEBIT'],
  ['810001','مصروف الزكاة','Zakat expense','DEBIT'],
  ['810002','مصروف ضريبة الدخل','Income tax expense','DEBIT'],
] as const;

const specialized:Record<FinancialIndustry,readonly (readonly [string,string,string,'DEBIT'|'CREDIT'])[]> = {
  GENERAL:[
    ['130011','دفعات مقدمة للموردين','Supplier prepayments','DEBIT'],
    ['170011','مخزون بضائع تجارية','Merchandise inventory','DEBIT'],
    ['410011','مبيعات بضائع','Merchandise sales','CREDIT'],
    ['510011','تكلفة البضائع المباعة','Cost of merchandise sold','DEBIT'],
    ['610011','مصاريف التوزيع والبيع','Sales & distribution expenses','DEBIT'],
  ],
  SERVICES:[
    ['410021','إيرادات الخدمات المهنية','Professional service revenue','CREDIT'],
    ['510021','تكاليف تقديم الخدمات','Direct service delivery costs','DEBIT'],
    ['610021','خدمات واستشارات خارجية','Outsourced services','DEBIT'],
  ],
  REAL_ESTATE:[
    ['170041','عقارات معدة للبيع','Properties held for sale','DEBIT'],
    ['170042','مشاريع تطوير عقاري تحت التنفيذ','Real estate development work in progress','DEBIT'],
    ['160041','عقارات استثمارية','Investment properties','DEBIT'],
    ['410041','إيرادات بيع العقارات','Property sales revenue','CREDIT'],
    ['410042','إيرادات الإيجارات','Rental revenue','CREDIT'],
    ['510041','تكلفة العقارات المباعة','Cost of properties sold','DEBIT'],
  ],
  INVESTMENTS:[
    ['160061','استثمارات في الأسهم','Equity investments','DEBIT'],
    ['160062','استثمارات في الصكوك والسندات','Sukuk & bond investments','DEBIT'],
    ['160063','ودائع استثمارية لأجل','Investment term deposits','DEBIT'],
    ['410061','إيرادات توزيعات الأرباح','Dividend income','CREDIT'],
    ['410062','عوائد الاستثمارات','Investment returns','CREDIT'],
    ['710061','تكاليف تمويل الاستثمارات','Investment financing costs','DEBIT'],
  ],
  HEALTH:[
    ['170081','مخزون الأدوية','Pharmaceutical inventory','DEBIT'],
    ['170082','مستلزمات طبية','Medical supplies inventory','DEBIT'],
    ['410081','إيرادات الخدمات الطبية','Medical service revenue','CREDIT'],
    ['410082','مبيعات الصيدلية','Pharmacy sales','CREDIT'],
    ['510081','تكاليف تقديم الخدمات الطبية','Direct medical service costs','DEBIT'],
    ['510082','تكلفة الأدوية المباعة','Cost of medicines sold','DEBIT'],
  ],
  EDUCATION:[
    ['240091','رسوم تعليمية محصلة مقدمًا','Deferred tuition receipts','CREDIT'],
    ['410091','إيرادات الرسوم الدراسية','Tuition revenue','CREDIT'],
    ['410092','إيرادات خدمات تعليمية أخرى','Other educational service revenue','CREDIT'],
    ['510091','تكاليف التدريس المباشرة','Direct teaching costs','DEBIT'],
    ['610091','مصاريف الإدارة المدرسية','School administration expenses','DEBIT'],
  ],
};

function materialize(items:readonly (readonly [string,string,string,'DEBIT'|'CREDIT'])[],source:FinancialAccountTemplate['source']):FinancialAccountTemplate[]{
  return items.map(([code,nameAr,nameEn,normalSide])=>({code,parentCode:code.slice(0,4),nameAr,nameEn,normalSide,source}));
}

export function isFinancialIndustry(value:unknown):value is FinancialIndustry{
  return FINANCIAL_INDUSTRIES.some(industry=>industry.id===value);
}

export function industryAccountTemplate(industry:FinancialIndustry):FinancialAccountTemplate[]{
  return [...materialize(core,'CORE'),...materialize(specialized[industry],industry)];
}

export function industryTemplatePreview<T extends {code:string;ar:string;en:string;normalSide:string;isActive:boolean;isPostable:boolean}>(industry:FinancialIndustry,accounts:readonly T[]){
  const existing=new Map(accounts.map(account=>[account.code,account]));
  return industryAccountTemplate(industry).map(template=>{
    const current=existing.get(template.code);
    const status=!current?'available':current.ar===template.nameAr&&current.en===template.nameEn&&current.normalSide===template.normalSide&&current.isActive&&current.isPostable?'matching':'occupied';
    return {...template,status} as const;
  });
}
