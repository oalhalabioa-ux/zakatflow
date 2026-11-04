export type ChartAccountRoot={code:string;parentCode:string|null;kind:string;presentation?:string};
export type ChartAccountSection<T>={key:string;ar:string;en:string;accounts:T[]};
export type ChartAccountGroup<T>={key:string;ar:string;en:string;sections:ChartAccountSection<T>[]};

/** Read-only reporting taxonomy: does not change or replace 4-digit control accounts. */
export function accountingPresentationTree<T extends ChartAccountRoot>(accounts:readonly T[]):ChartAccountGroup<T>[]{
 const roots=accounts.filter(a=>!a.parentCode);
 const section=(key:string,ar:string,en:string,items:T[]):ChartAccountSection<T>=>({key,ar,en,accounts:items});
 const by=(kind:string,presentation?:string)=>roots.filter(a=>a.kind===kind&&(presentation===undefined||a.presentation===presentation));
 const split=(kind:string)=>[
  section(kind+'-current','أصول أو التزامات متداولة','Current',by(kind,'CURRENT')),
  section(kind+'-noncurrent','أصول أو التزامات غير متداولة','Non-current',by(kind,'NON_CURRENT')),
  section(kind+'-unclassified','غير مصنفة زمنياً','Unclassified',roots.filter(a=>a.kind===kind&&!['CURRENT','NON_CURRENT'].includes(a.presentation??''))),
 ].filter(s=>s.accounts.length);
 const simple=(key:string,ar:string,en:string,kind:string):ChartAccountGroup<T>=>({
  key,ar,en,sections:[section(key+'-accounts','الحسابات الرقابية','Control accounts',by(kind))],
 });
 const groups:ChartAccountGroup<T>[]=[
  {key:'assets',ar:'الأصول',en:'Assets',sections:split('ASSET').map(s=>({...s,ar:s.key==='ASSET-current'?'الأصول المتداولة':s.key==='ASSET-noncurrent'?'الأصول غير المتداولة':s.ar,en:s.key==='ASSET-current'?'Current assets':s.key==='ASSET-noncurrent'?'Non-current assets':s.en}))},
  {key:'liabilities',ar:'الالتزامات',en:'Liabilities',sections:split('LIABILITY').map(s=>({...s,ar:s.key==='LIABILITY-current'?'الالتزامات المتداولة':s.key==='LIABILITY-noncurrent'?'الالتزامات غير المتداولة':s.ar,en:s.key==='LIABILITY-current'?'Current liabilities':s.key==='LIABILITY-noncurrent'?'Non-current liabilities':s.en}))},
  simple('equity','حقوق الملكية','Equity','EQUITY'),
  simple('revenue','الإيرادات','Revenue','REVENUE'),
  simple('cogs','تكلفة المبيعات','Cost of sales','COGS'),
  simple('opex','المصروفات التشغيلية','Operating expenses','OPEX'),
  simple('finance','تكاليف التمويل','Finance costs','FINANCE'),
  simple('tax','الزكاة والضريبة','Zakat & tax','TAX'),
 ];
 const known=new Set(['ASSET','LIABILITY','EQUITY','REVENUE','COGS','OPEX','FINANCE','TAX']);
 const remaining=roots.filter(a=>!known.has(a.kind));
 if(remaining.length)groups.push({key:'other',ar:'حسابات أخرى للمراجعة',en:'Other accounts for review',sections:[section('other-controls','حسابات رقابية أخرى','Other control accounts',remaining)]});
 return groups.filter(g=>g.sections.some(s=>s.accounts.length));
}

export type ChartPostingIntegration='NOT_YET_ACTIVE'|'POLICY_RULES_ONLY'|'POLICY_AND_OPENING';
/** UI readiness is an exact reflection of the server integration phase, never an approval claim. */
export function chartIntegrationMessage(level:ChartPostingIntegration|undefined,locale:string):string{
 const en=locale==='en';
 if(level==='POLICY_AND_OPENING')return en?
  'Active detail accounts can be selected in posting policies and opening balances. Financial statements still require an explicitly saved fiscal calendar, approved opening balances and posting rules, and actually posted source vouchers. No balance is approved automatically.':
  'يمكن ربط الحسابات التفصيلية النشطة بقواعد الترحيل والأرصدة الافتتاحية. ظهور القوائم المالية يتطلب حفظ التقويم المالي واعتماد الافتتاحي وقواعد الترحيل وترحيل السندات فعلياً. لا يُعتمد أي رصيد تلقائياً.';
 if(level==='POLICY_RULES_ONLY')return en?
  'Active detail accounts can be used in posting policies. Opening-balance integration is not yet available at this stage.':
  'يمكن استخدام الحسابات التفصيلية النشطة في قواعد الترحيل، لكن ربط الأرصدة الافتتاحية غير متاح في هذه المرحلة.';
 return en?
  'Detail accounts are saved in the chart, but their financial posting integration is not enabled.':
  'الحسابات الفرعية محفوظة في الدليل، وربطها المحاسبي لم يُفعّل بعد.';
}
