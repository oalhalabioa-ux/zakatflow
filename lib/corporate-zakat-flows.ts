export type ZakatCategory={id:string;organization_id:string;accounting_group?:string;treatment_code?:string};
export function corporateZakatFlows<T extends {organization_id:string;category_id?:string|null;direction:string;transfer_id?:string|null;intercompany_transfer_id?:string|null}>(flows:T[],categories:ZakatCategory[],organizationIds:string[]):T[]{
 const ids=new Set(organizationIds);
 return flows.filter(f=>ids.has(f.organization_id)&&f.direction==='OUTFLOW'&&!f.transfer_id&&!f.intercompany_transfer_id&&categories.some(c=>c.id===f.category_id&&c.organization_id===f.organization_id&&(c.accounting_group==='ZAKAT'||['ZAKAT_ACCRUAL','ZAKAT_PAYMENT'].includes(c.treatment_code??''))));
}
