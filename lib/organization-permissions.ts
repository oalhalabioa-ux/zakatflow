export const PERMISSION_GROUPS = [
 {key:'financial_core',labelAr:'المحرك المالي',labelEn:'Financial Core',permissions:['financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve']},
 {key:'liquidity',labelAr:'السيولة والخزينة',labelEn:'Cash & Treasury',permissions:['liquidity.view','liquidity.edit','liquidity.settle']},
 {key:'vat',labelAr:'الضريبة والفواتير',labelEn:'VAT & Invoicing',permissions:['vat.view','vat.edit','vat.issue']},
 {key:'assets',labelAr:'الأصول',labelEn:'Assets',permissions:['assets.view','assets.edit']},
 {key:'budget',labelAr:'الموازنة والتخطيط',labelEn:'Budget & Planning',permissions:['budget.view','budget.edit','budget.submit','budget.approve']},
 {key:'zakat',labelAr:'الزكاة',labelEn:'Zakat',permissions:['zakat.view','zakat.edit']},
 {key:'audit',labelAr:'المراجعة والرقابة',labelEn:'Audit & Controls',permissions:['audit.view']},
 {key:'organization',labelAr:'المنشأة',labelEn:'Organization',permissions:['organization.view']},
] as const;

export const SENSITIVE_PERMISSIONS = new Set([
 'financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve','liquidity.settle','budget.approve'
]);

export const permissionAction=(permission:string)=>permission.split('.').at(-1)??permission;
