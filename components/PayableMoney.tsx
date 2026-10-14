'use client';
import {Money,useDisplayCurrencyCode} from './DisplayCurrency';
export default function PayableMoney(props:Parameters<typeof Money>[0]){const source=props.currency??'SAR',display=useDisplayCurrencyCode(source).replace(' *','');return <><Money {...props}/>{display!==source&&<small className="payable-source-money" dir="ltr">{new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Number(props.value))} {source} · الأصل</small>}</>;}
