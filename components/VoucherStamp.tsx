import './voucher-stamp.css';
import {sourceVoucher,type VoucherDomain} from '../lib/source-voucher';
export default function VoucherStamp({domain,record,ar=true}:{domain:VoucherDomain;record?:any;ar?:boolean}){
 const identity=sourceVoucher(domain,record,ar);
 return <dl className="payable-detail-grid voucher-stamp" aria-label={ar?'هوية السند':'Voucher identity'}><div><dt>{ar?'نوع السند':'Voucher type'}</dt><dd>{identity.voucherType}</dd></div><div><dt>{ar?'رقم السند':'Voucher number'}</dt><dd><bdi>{identity.voucherNumber||(ar?'يُحدد عند الحفظ':'Assigned on save')}</bdi></dd></div></dl>;
}
