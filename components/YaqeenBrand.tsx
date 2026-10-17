/** The supplied approved artwork is displayed unchanged, cropped only by its frame. */
export default function YaqeenBrand({compact=false}:{compact?:boolean}){
 return <span className={`yaqeen-brand-art ${compact?'is-compact':''}`} role="img" aria-label="يقين الأعمال | YAQEEN BUSINESS"><img src="/brand/yaqeen-approved-reference.png" width="1085" height="960" alt=""/></span>;
}
