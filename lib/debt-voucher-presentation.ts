import type {DebtItem} from './financial-register';
import {debtSourceName} from './debt-categories';
import {voucherNumber} from './voucher-identity';

export function debtVoucherType(row:DebtItem):string{
 if(row.isOpening)return 'رصيد افتتاحي';
 const label=row.voucherType??debtSourceName(row.source);
 if(['عقد قرض','إضافة قرض مستلم','إضافة قرض ممنوح'].includes(label))return row.side==='PAYABLE'?'قرض دائن':row.side==='RECEIVABLE'?'قرض مدين':label;
 if(['إثبات رأس مال مشاركة','عقد استثمار ومشاركة'].includes(label))return 'عقد مشاركة';
 return label;
}
export const debtVoucherNumber=(row:DebtItem)=>row.voucherNumber??voucherNumber(row.sourceDebtId??row.id,row.side==='PAYABLE'?'AP':'AR');
export function matchesDebtVoucher(row:DebtItem,query:string):boolean{
 const normalize=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
 return normalize([row.partyName,row.description,row.reference,row.rawReference,debtVoucherType(row),debtVoucherNumber(row)].join(' ')).includes(normalize(query));
}
