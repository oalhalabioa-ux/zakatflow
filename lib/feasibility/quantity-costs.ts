import {z} from 'zod';
const number=z.number().finite().min(0).max(1e12);
export const quantityLineSchema=z.object({
 id:z.string().min(1).max(100),name:z.string().max(300),category:z.string().max(100),unit:z.string().max(60),
 basis:z.enum(['MANUAL','LAND_AREA','BUILT_AREA','CAPACITY','NET_AREA','SALE_AREA','ROAD_LENGTH','NETWORK_LENGTH','SERVICE_AREA']),
 quantity:number,unitCost:number,source:z.string().max(1000),
 phasing:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1)]).optional(),
}).strict();
export type QuantityLine=z.infer<typeof quantityLineSchema>;
export const quantityBudgetSchema=z.object({enabled:z.boolean(),items:z.array(quantityLineSchema).max(100)}).strict();
export type QuantityBudget=z.infer<typeof quantityBudgetSchema>;
export function evaluateQuantityBudget(budget:QuantityBudget|undefined,context:Partial<Record<QuantityLine['basis'],number>>){
 const rows=(budget?.items??[]).map(item=>{
  const quantity=item.quantity*(item.basis==='MANUAL'?1:context[item.basis]??0);
  return {...item,effectiveQuantity:quantity,total:quantity*item.unitCost};
 });
 const total=rows.reduce((s,x)=>s+x.total,0);
 const blockers=budget?.enabled?[
  ...(!rows.length?['EMPTY_BUDGET']:[]),
  ...rows.filter(x=>!x.name.trim()||!x.unit.trim()||x.effectiveQuantity<=0||x.unitCost<=0||!Number.isFinite(x.total)||x.total>1e12).map(x=>'INCOMPLETE:'+x.id),
  ...rows.filter(x=>!x.source.trim()).map(x=>'UNDOCUMENTED:'+x.id),
  ...rows.filter(x=>x.phasing&&Math.abs(x.phasing.reduce((s,v)=>s+v,0)-1)>1e-8).map(x=>'PHASING:'+x.id),
  ...(new Set(rows.map(x=>x.id)).size!==rows.length?['DUPLICATE_IDS']:[]),
  ...(!Number.isFinite(total)||total>1e12?['TOTAL_LIMIT']:[]),
 ]:[];
 return {rows,total,blockers,ready:blockers.length===0};
}

export function quantityIssueLabel(code:string,locale:string,items:readonly QuantityLine[]=[]){
 const ar=locale==='ar',key=code.split(':')[0],id=code.slice(key.length+1),name=items.find(x=>x.id===id)?.name;
 const labels:Record<string,readonly [string,string]>={
  EMPTY_BUDGET:['جدول الكميات فارغ','Quantity budget is empty'],INCOMPLETE:['أكمل الوصف والوحدة والكمية والسعر','Complete description, unit, quantity and price'],
  UNDOCUMENTED:['أضف مرجع السعر وتاريخه','Add price evidence and date'],DUPLICATE_IDS:['بنود مكررة تحتاج تصحيحًا','Duplicate items require correction'],
  TOTAL_LIMIT:['إجمالي الكميات يتجاوز الحد المسموح','Quantity total exceeds the supported limit'],CATEGORY:['صحح تصنيف البند','Correct the item category'],
  MATERIAL_INPUTS:['أكمل مدخلات المواد ومرجع أسعارها','Complete materials and price evidence'],LAND_VALUATION:['أكمل مساحة الأرض وسعرها ومرجع تقييمها','Complete land area, price and valuation evidence'],
  LAND_LIMIT:['قيمة الأرض تتجاوز الحد المسموح','Land value exceeds the supported limit'],WATER_SOURCE_EVIDENCE:['وثّق مصدر المياه والترخيص والكمية المرخصة','Document water source, permit and licensed volume'],
  PHASING:['مجموع مراحل البند يجب أن يساوي 100%','Item phasing must add to 100%'],
  LICENSED_WATER_CAPACITY:['الطلب على المياه يتجاوز الكمية المرخصة','Water demand exceeds licensed capacity'],PUMP_CAPACITY:['الطلب على المياه يتجاوز طاقة الضخ','Water demand exceeds pumping capacity'],
 };
 const label=labels[key]??['تحتاج المدخلات مراجعة','Inputs need review'];
 return (ar?label[0]:label[1])+(name?' · '+name:'');
}
