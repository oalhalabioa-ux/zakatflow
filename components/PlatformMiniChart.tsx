'use client';
import {useDisplayMoney} from './DisplayCurrency';
export default function PlatformMiniChart({values,label,bars=false,currency='SAR'}:{values:number[];label:string;bars?:boolean;currency?:string}){
 const money=useDisplayMoney();
 const finite=values.filter(v=>Number.isFinite(v));
 if(!finite.length)return <div className="platform-mini-chart platform-chart-empty"><svg viewBox="0 0 160 80" aria-hidden="true"><path d="M25 66V22h42v44M67 66V10h45v56M112 66V38h24v28M15 66h130" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M34 32h8m8 0h8m-24 12h8m8 0h8M76 22h9m10 0h9M76 34h9m10 0h9M76 46h9m10 0h9" stroke="currentColor" strokeWidth="3" opacity=".4"/></svg><small>{label} · —</small></div>;
 const min=Math.min(0,...finite),max=Math.max(...finite),range=max-min||1;
 const y=(v:number)=>68-(v-min)/range*55;
 const x=(i:number)=>8+i*144/Math.max(1,finite.length-1);
 const points=finite.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
 return <figure className="platform-mini-chart"><svg viewBox="0 0 160 80" role="img" aria-label={label} preserveAspectRatio="none"><path d="M5 70h150" stroke="currentColor" opacity=".12"/>{bars?finite.map((v,i)=><rect key={i} x={8+i*144/finite.length} y={Math.min(y(v),y(0))} width={Math.max(2,144/finite.length-4)} height={Math.max(1,Math.abs(y(v)-y(0)))} rx="2" fill="currentColor" opacity={.25+(i%3)*.15}><title>{`${i+1}: ${money(v,currency)}`}</title></rect>):<><polygon points={`8,70 ${points} 152,70`} fill="currentColor" opacity=".07"/><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/></>}</svg><figcaption>{label}</figcaption></figure>;
}
