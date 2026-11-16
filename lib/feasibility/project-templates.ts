import {createWaterModel} from './water-model';
import {
 createStudy,waterFactoryLegalItems,
 type CapitalCategory,type FeasibilityStudy
} from './engine';

/** Opt-in reusable starters. No jurisdiction, pricing, permit value or accounting posting is implied. */
export type IndustrialStarter='GENERAL'|'BOTTLED_WATER'|'DAIRY_CHEESE';

type StarterDefinition={
 capex:readonly (readonly [string,CapitalCategory])[];
 tasks:readonly string[];
 legal:readonly string[];
};
const industrialStarters:Record<Exclude<IndustrialStarter,'GENERAL'>,StarterDefinition>={
 BOTTLED_WATER:{
  capex:[
   ['أعمال الإنشاء وتجهيز مبنى المصنع','BUILDINGS'],
   ['آلات معالجة وتنقية المياه','EQUIPMENT'],
   ['خط تعبئة المياه وإغلاق العبوات','EQUIPMENT'],
   ['معدات الملصقات والتغليف والكرتون','EQUIPMENT'],
   ['المختبر ومعدات مراقبة الجودة','EQUIPMENT'],
   ['شبكات الطاقة والمياه والخدمات','UTILITIES'],
   ['مستودعات وتخزين المنتج','BUILDINGS'],
   ['وسائل النقل والتوزيع','EQUIPMENT'],
   ['رسوم تراخيص وموافقات جديدة (إن وجدت)','LICENCES']
  ],
  tasks:[
   'التحقق من ملكية الأرض وقابلية استخدامها أو نقلها للشركة',
   'الحصول على تقييم مستقل للأرض وتوثيق مساهمة الشريك',
   'التحقق من الترخيص وحقوق استعماله أو نقله وقيمته القابلة للاعتراف',
   'حصر عروض خط المعالجة والتعبئة والتغليف والمقاولين',
   'توثيق مصدر المياه ومعدلات الضخ والفحوص المخبرية',
   'إعداد تكاليف العبوة والغطاء والملصق والكرتون والطاقة',
   'إعداد خطة البيع والتوزيع والتحصيل ورأس المال العامل',
   'مراجعة التمويل النقدي وقروض الشركاء ونسب الملكية'
  ],
  legal:[
   ...waterFactoryLegalItems,
   'تقييم مستقل لحق الترخيص ومدى إمكان تحويله إلى مساهمة عينية',
   'التحقق من ملكية الأرض وشروط نقلها أو استئجارها لصالح الشركة',
   'توثيق اتفاق الشركاء ونسب الملكية ومساهمة كل طرف بعد التقييم',
   'اختبار استدامة البئر أو النبع وخطة حماية المصدر',
   'فحص المخطط التنظيمي ومدخل الشاحنات والكهرباء والصرف',
   'التحقق من أهلية الشركاء غير المحليين وشروط الاستثمار والتحويلات',
   'التحقق من الحسابات المصرفية والتوقيع والاعتمادات',
   'التحقق من العلامة التجارية ومطابقة العبوة والملصقات'
  ]
 },
 DAIRY_CHEESE:{
  capex:[
   ['استقبال الحليب والتبريد الأولي','EQUIPMENT'],
   ['المباني وأعمال النظافة والتصنيع الغذائي','BUILDINGS'],
   ['معدات البسترة والمعالجة','EQUIPMENT'],
   ['خطوط اللبن واللبنة والأجبان','EQUIPMENT'],
   ['معدات التعبئة والتغليف','EQUIPMENT'],
   ['غرف التبريد والتخزين','UTILITIES'],
   ['المختبر وضبط الجودة','EQUIPMENT'],
   ['مرافق الطاقة والمياه والصرف','UTILITIES'],
   ['وسائل النقل المبرد والتوزيع','EQUIPMENT'],
   ['رسوم التراخيص والموافقات (إن وجدت)','LICENCES']
  ],
  tasks:[
   'تحديد مصادر الحليب الخام وكمياته وجودته ونظام الاستلام',
   'تحديد المنتجات ومعدلات تحويل الحليب إلى لبن ولبنة وجبنة وقشطة',
   'مقارنة عروض خطوط البسترة والتصنيع والتعبئة والتبريد',
   'احتساب الفاقد والتبريد والتخزين والتوزيع لكل منتج',
   'إعداد تكلفة الحليب والطاقة والعمالة والتغليف لكل وحدة',
   'مراجعة خطة التسويق والتحصيل والمرتجعات ورأس المال العامل',
   'مراجعة شروط السلامة الغذائية والتراخيص والفحوص'
  ],
  legal:[
   'التحقق من تراخيص إنتاج وتعبئة وتسويق الألبان والأجبان',
   'التحقق من اشتراطات الحليب الخام وسلامة الغذاء وسلسلة التبريد',
   'تحديد متطلبات الفحوص المخبرية وتتبع الدفعات والصلاحية'
  ]
 }
};

/** A starter only changes editable labels/checklists. All valuations and inputs remain unentered. */
export function createIndustrialStarter(id:string,title:string,starter:IndustrialStarter):FeasibilityStudy{
 const study=createStudy(id,title,'INDUSTRIAL');
 if(starter==='GENERAL')return study;
 const template=industrialStarters[starter];
 return {
  ...study,
  ...(starter==='BOTTLED_WATER'?{water:createWaterModel()}:{}),
  capex:template.capex.map(([label,category],i)=>({
   id:'industry-capex-'+i,label,category,amount:0
  })),
  tasks:template.tasks.map((task,i)=>({
   id:'industry-task-'+i,title:task,owner:'',due:'',
   status:'TODO' as const,priority:'HIGH' as const
  })),
  legal:[
   ...study.legal.map((item,i)=>starter==='BOTTLED_WATER'&&i<7?{...item,critical:true}:item),
   ...template.legal.map((title,i)=>({
    id:'industry-legal-'+i,title,status:'NOT_STARTED' as const,notes:'',
    ...(starter==='BOTTLED_WATER'?{critical:i<7}:{} )
   }))
  ]
 };
}
