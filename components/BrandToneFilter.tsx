/** Tint the dark lettering while preserving the original gold and transparency. */
export default function BrandToneFilter({id,color}:{id:string;color:string}){
 return <filter id={id} colorInterpolationFilters="sRGB"><feFlood floodColor={color} result="tone"/><feComposite in="tone" in2="SourceGraphic" operator="in" result="base"/><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 4 0 -4 0 0" result="gold"/><feComposite in="gold" in2="SourceGraphic" operator="in" result="goldAlpha"/><feMerge><feMergeNode in="base"/><feMergeNode in="goldAlpha"/></feMerge></filter>;
}
