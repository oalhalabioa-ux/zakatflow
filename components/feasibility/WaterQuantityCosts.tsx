'use client';
import {effectiveWaterInputs,type WaterModel,waterCapexItemKeys} from '@/lib/feasibility/water-model';
import {quantityIssueLabel} from '@/lib/feasibility/quantity-costs';
import {quantityPresets} from '@/lib/feasibility/quantity-presets';
import QuantityBudgetEditor from './QuantityBudgetEditor';
export default function WaterQuantityCosts({water,onChange,locale}:{water:WaterModel;onChange:(v:WaterModel)=>void;locale:string}){
 const l=(a:string,e:string)=>locale==='ar'?a:e,q=water.quantityCosting??{builtArea:0,capital:{enabled:false,items:[]},fixed:{enabled:false,items:[]},materialsEnabled:false,materialSource:'',landByArea:false,landUnitPrice:0,landSource:''};
 const patch=(p:Partial<typeof q>)=>onChange({...water,quantityCosting:{...q,...p}}),effective=effectiveWaterInputs(water);
 const context={LAND_AREA:water.deal.landArea,BUILT_AREA:q.builtArea,CAPACITY:water.ops.bottlesHour};
 return <div className="fs-block"><section className="card fs-panel"><h3>{l('ربط المساحات والتكاليف','Area and cost linkage')}</h3><div className="fs-form-grid">
  <label className="fs-field"><span>{l('إجمالي مساحة البناء م²','Total built floor area m²')}</span><input type="number" min={0} value={q.builtArea} onChange={e=>patch({builtArea:Math.max(0,Number(e.target.value)||0)})}/></label>
  <label className="fs-check"><input type="checkbox" checked={q.landByArea} onChange={e=>patch({landByArea:e.target.checked})}/>{l('قيمة الأرض = مساحة الأرض × سعر المتر','Land value = site area × unit price')}</label>
  <label className="fs-field"><span>{l('سعر متر الأرض','Land price per m²')}</span><input type="number" min={0} value={q.landUnitPrice} onChange={e=>patch({landUnitPrice:Math.max(0,Number(e.target.value)||0)})}/></label>
  <label className="fs-field"><span>{l('مرجع تقييم الأرض','Land valuation reference')}</span><input maxLength={1000} value={q.landSource} onChange={e=>patch({landSource:e.target.value})}/></label>
 </div><p>{l('القيمة المستخدمة للأرض','Effective land value')}: {effective.deal.landValue}</p>
 <p className="fs-hint">{l('اختر شراء نقدي أو حصة عينية أو إيجار أو انتفاع في الشراكة. مساحة البناء إجمالية، وقد تشمل عدة طوابق.','Choose cash purchase, in-kind title, lease or right of use in Partnership. Built area is total floor area and may include multiple floors.')}</p></section>
 <QuantityBudgetEditor presets={quantityPresets('water')} title={l('كميات الإنشاء والمعدات والمرافق','Construction, equipment and utilities quantities')} locale={locale} value={q.capital} onChange={capital=>patch({capital})} context={context}
  categories={waterCapexItemKeys.map((k,i)=>[k,...([
   ['مبانٍ وإنشاءات','Buildings and construction'],['خط التعبئة','Bottling line'],['معالجة المياه','Water treatment'],['مرافق الطاقة','Power utilities'],
   ['المختبر','Laboratory'],['وسائل النقل','Vehicles'],['التراخيص والتأسيس','Licences and setup'],['أخرى','Other']
  ][i])] as [string,string,string])}
  bases={ [['MANUAL','كمية يدوية','Manual quantity'],['LAND_AREA','مساحة الأرض','Site area'],['BUILT_AREA','مساحة البناء','Built area'],['CAPACITY','طاقة العبوات بالساعة','Bottles/hour capacity']]}/>
 <QuantityBudgetEditor title={l('العمالة والتكاليف الشهرية الثابتة','Labour and monthly fixed costs')} locale={locale} value={q.fixed} onChange={fixed=>patch({fixed})} context={context}
  categories={ [['labour','عمالة','Labour'],['utilities','مرافق ثابتة','Fixed utilities'],['other','أخرى','Other']]}
  bases={ [['MANUAL','عدد العاملين أو الكمية','Headcount or quantity'],['BUILT_AREA','مساحة البناء','Built area'],['CAPACITY','الطاقة الإنتاجية','Capacity']]}/>
 <section className="card fs-panel"><label className="fs-check"><input type="checkbox" checked={q.materialsEnabled} onChange={e=>patch({materialsEnabled:e.target.checked})}/>{l('استخدام تكلفة العبوات والمياه والطاقة والتوزيع المحسوبة بدل التكلفة المتغيرة اليدوية','Use calculated packaging, water, electricity and distribution instead of manual variable cost')}</label>
 <p>{l('التكلفة المحسوبة للكرتون','Calculated cost per carton')}: {effective.material?.total??'—'}</p>
 <label className="fs-field"><span>{l('مرجع أسعار المواد والطاقة','Materials and energy price reference')}</span><input maxLength={1000} value={q.materialSource} onChange={e=>patch({materialSource:e.target.value})}/></label>
 <p className="fs-hint">{l('تُحرّر كميات وأسعار المواد في الإنتاج والتفاصيل. الأجور هنا شهرية، وإيجار الأرض يُحسب منفصلًا من الشراكة؛ لا تكرره في البنود.','Edit material quantities/prices in Operations and its details. Wages are monthly; land rent is added separately from Partnership, so do not repeat it in these items.')}</p>
 <label className="fs-check"><input type="checkbox" checked={q.productionEnabled??false} onChange={e=>patch({productionEnabled:e.target.checked})}/>{l('خصم فاقد المنتج النهائي من المبيعات مع إبقاء تكلفة الإنتاج كاملة','Deduct finished-product waste from sales while retaining full production cost')}</label>
 <p className="fs-hint">{l('يطبق هذا الخيار فاقد المنتج النهائي المسجل في تفاصيل الإنتاج، ويتحقق من حدود الترخيص والضخ. فاقد التعبئة يخص مدخلات المواد ويظل منفصلًا.','This applies finished-product waste recorded in Operations details and checks permit/pumping limits. Packaging input loss remains separate.')}</p>
 <label className="fs-field"><span>{l('توثيق افتراضات التشغيل والبيع والتمويل','Operating, sales and funding assumption evidence')}</span><textarea maxLength={3000} value={q.assumptionSource??''} onChange={e=>patch({assumptionSource:e.target.value})}/></label>
 {!effective.readiness.ready&&<ul role="alert">{effective.readiness.blockers.map((code,i)=><li key={i}>{quantityIssueLabel(code,locale,[...q.capital.items,...q.fixed.items])}</li>)}</ul>}</section></div>;
}
