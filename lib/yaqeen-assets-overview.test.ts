import {expect,it} from 'vitest';
import {zakatAllocationPresentation} from './yaqeen-assets-overview';
it('groups only positive saved eligible amounts without recalculating or rounding each line',()=>{
 expect(zakatAllocationPresentation([
  {eligible_value:'0.105',eligibility_status:'ELIGIBLE',lots:{asset_account_id:'g'}},
  {eligible_value:'0.105',eligibility_status:'ELIGIBLE',lots:[{asset_account_id:'g'}]},
  {eligible_value:'50',eligibility_status:'HAWL_NOT_COMPLETED',lots:{asset_account_id:'g'}},
  {eligible_value:'-5',eligibility_status:'ELIGIBLE'},
  {eligible_value:'NaN',eligibility_status:'ELIGIBLE'},
  {eligible_value:'20',eligibility_status:'ELIGIBLE',lots:{asset_account_id:'missing'}},
 ],[{id:'g',asset_type:'GOLD'}])).toEqual([{type:'GOLD',value:'0.21'},{type:'OTHER',value:'20.00'}]);
});
it('shows no distribution when there are no eligible saved lines',()=>{
 expect(zakatAllocationPresentation([],[])).toEqual([]);
});
