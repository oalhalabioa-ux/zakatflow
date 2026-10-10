// Presentation categories do not rewrite persisted accounting classifications.
export const ASSET_DISPLAY_CLASSES = [
  ['CASH','النقد والحسابات البنكية','Cash and bank accounts','▥'],
  ['INVESTMENT','الاستثمارات المالية','Financial investments','↗'],
  ['METALS','المعادن الثمينة','Precious metals','◆'],
  ['PROPERTY','العقارات الاستثمارية','Investment property','⌂'],
  ['PPE','الممتلكات والآلات والمعدات','Property, plant and equipment','⚙'],
  ['INVENTORY','المخزون','Inventory','▦'],
  ['RECEIVABLE','الذمم المدينة','Receivables','≡'],
  ['INTANGIBLE','الأصول غير الملموسة','Intangible assets','◈'],
  ['OTHER','أصول أخرى','Other assets','▣'],
  ['UNCLASSIFIED','أصول تحتاج استكمال التصنيف','Assets awaiting classification','?'],
] as const;
const TYPE_ICONS:Record<string,string>={CASH:'¤',BANK:'▥',GOLD:'◆',SILVER:'◇',LAND:'▱',BUILDING:'⌂',VEHICLE:'🚗',MACHINERY:'⚙',FURNITURE:'▤',IT_EQUIPMENT:'▣',INVESTMENT_PROPERTY:'⌂',INVESTMENT_LAND:'▱',DEVELOPMENT_PROPERTY:'▧',EQUITY_INVESTMENT:'↗',FUND:'◫',SUKUK_BOND:'▥',BOND:'▤',DEPOSIT:'◉',RECEIVABLE:'≡',LOAN_RECEIVABLE:'⇢',OTHER_RECEIVABLE:'≣',RAW_MATERIAL:'▦',WORK_IN_PROGRESS:'⚒',FINISHED_GOODS:'▧',TRADING_INVENTORY:'▦',SOFTWARE:'⌘',LICENSE:'✓',TRADEMARK:'®',GOODWILL:'✧',PREPAYMENT:'◷',ADVANCE:'⇢',REFUNDABLE_DEPOSIT:'◈',OTHER_ASSET:'•',STOCK:'↗',REAL_ESTATE:'⌂',INVENTORY:'▦',OTHER:'•'};
export function assetTypeIcon(code:string){return TYPE_ICONS[code]||'•';}
export function assetDisplayClass(a:{asset_type?:string;asset_type_code?:string|null;asset_class_code?:string|null}){
 const t=a.asset_type_code||a.asset_type;
 if(['CASH','BANK'].includes(t||''))return 'CASH';
 if(['GOLD','SILVER'].includes(t||''))return 'METALS';
 if(['RECEIVABLE','LOAN_RECEIVABLE','OTHER_RECEIVABLE'].includes(t||''))return 'RECEIVABLE';
 if(['INVESTMENT_PROPERTY','INVESTMENT_LAND','DEVELOPMENT_PROPERTY'].includes(t||''))return 'PROPERTY';
 if(t==='DEPOSIT'||a.asset_class_code==='INVESTMENT'||t==='STOCK')return 'INVESTMENT';
 if(['PPE','INVENTORY','INTANGIBLE','OTHER'].includes(a.asset_class_code||''))return a.asset_class_code!;
 if(t==='INVENTORY')return 'INVENTORY';
 return 'UNCLASSIFIED';
}
export function catalogDisplayClass(t:{code:string;class_code:string;default_legacy_asset_type?:string}){return assetDisplayClass({asset_type_code:t.code,asset_class_code:t.class_code,asset_type:t.default_legacy_asset_type});}
