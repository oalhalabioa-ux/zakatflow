import type {QuantityLine} from './quantity-costs';

/** Public, unpriced specifications only. Never initialized from a saved/customer study. */
export function quantityPresets(sector:'water'|'land'):QuantityLine[]{
 const rows:readonly (readonly [string,string,QuantityLine['basis'],string])[]=sector==='water'?[
  ['buildings','Construction / أعمال البناء','BUILT_AREA','m²'],['line','Bottling equipment / خط التعبئة','MANUAL','unit'],
  ['treatment','Water treatment / معالجة المياه','MANUAL','unit'],['power','Power utilities / مرافق الطاقة','MANUAL','unit'],
  ['lab','Laboratory / المختبر','MANUAL','unit'],['vehicles','Distribution vehicles / النقل','MANUAL','unit'],
  ['licenses','Licences and setup / التراخيص','MANUAL','unit'],
 ]:[
  ['earthworks','Earthworks / أعمال التسوية','NET_AREA','m³'],['roads','Roads / الطرق والأرصفة','ROAD_LENGTH','m²'],
  ['water','Water network / شبكة المياه','NETWORK_LENGTH','m'],['sewer','Sewer and drainage / الصرف والتصريف','NETWORK_LENGTH','m'],
  ['electric','Power and communications / الكهرباء والاتصالات','NETWORK_LENGTH','m'],['services','Facilities and services / المرافق والخدمات','SERVICE_AREA','m²'],
 ];
 return rows.map(([category,name,basis,unit],i)=>({id:sector+'-quantity-'+i,category,name,basis,unit,quantity:0,unitCost:0,source:''}));
}
