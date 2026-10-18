type Options={target?:EventTarget;isVisible?:()=>boolean;isBusy?:()=>boolean;intervalMs?:number};
/** Coalesce focus and periodic refreshes; never start another request while one is pending. */
export function subscribeDashboardRefresh(refresh:()=>void,{target=window,isVisible=()=>document.visibilityState==='visible',isBusy=()=>false,intervalMs=30000}:Options={}){
 let lastStarted=Date.now();
 const run=()=>{const now=Date.now();if(!isVisible()||isBusy()||now-lastStarted<intervalMs)return;lastStarted=now;refresh()};
 target.addEventListener('focus',run);
 const timer=setInterval(run,intervalMs);
 return()=>{target.removeEventListener('focus',run);clearInterval(timer)};
}
