/** Source roles emitted by prepare_asset_lifecycle for NEW commands only.
 * Never infer these roles from an old ambiguous BASE event or from its name. */
export const ASSET_LIFECYCLE_POSTING_TEMPLATES = [
 {type:'OPEX',role:'DEPRECIATION',debit:'6200',credit:'1590',ar:'إثبات الإهلاك',en:'Depreciation'},
 {type:'OPEX',role:'DISPOSAL_LOSS',debit:'6100',credit:'1500',ar:'خسارة استبعاد أصل',en:'Asset disposal loss'},
 {type:'OPEX',role:'SALE_LOSS',debit:'6100',credit:'1100',ar:'خسارة بيع أصل',en:'Asset sale loss'},
 {type:'REVENUE',role:'SALE_GAIN',debit:'1100',credit:'4100',ar:'ربح بيع أصل',en:'Asset sale gain'},
 {type:'ASSET',role:'SALE_NET_BOOK_VALUE',debit:'1100',credit:'1500',ar:'استبعاد صافي القيمة الدفترية',en:'Release net book value'},
 {type:'ASSET',role:'ACCUMULATED_DEPRECIATION_RELEASE',debit:'1590',credit:'1500',ar:'استبعاد مجمع الإهلاك',en:'Release accumulated depreciation'},
 {type:'TAX',role:'OUTPUT_VAT',debit:'1100',credit:'2300',ar:'ضريبة بيع الأصل',en:'Asset sale output VAT'},
 // Investments are released from their own control, never fixed assets.
 {type:'OPEX',role:'INVESTMENT_DISPOSAL_LOSS',debit:'6100',credit:'1600',ar:'خسارة استبعاد استثمار',en:'Investment disposal loss'},
 {type:'OPEX',role:'INVESTMENT_SALE_LOSS',debit:'6100',credit:'1100',ar:'خسارة بيع استثمار',en:'Investment sale loss'},
 {type:'REVENUE',role:'INVESTMENT_SALE_GAIN',debit:'1100',credit:'4100',ar:'ربح بيع استثمار',en:'Investment sale gain'},
 {type:'ASSET',role:'INVESTMENT_SALE_NET_BOOK_VALUE',debit:'1100',credit:'1600',ar:'استبعاد القيمة الدفترية للاستثمار',en:'Release investment book value'},
 {type:'TAX',role:'INVESTMENT_OUTPUT_VAT',debit:'1100',credit:'2300',ar:'ضريبة بيع الاستثمار إن انطبقت',en:'Investment sale VAT when applicable'},
] as const;
