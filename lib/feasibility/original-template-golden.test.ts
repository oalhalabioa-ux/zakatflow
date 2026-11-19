import {it,expect} from 'vitest';
import golden from '../../tests/feasibility/original-template-golden.json';
import {evaluateWater,waterModelSchema} from './water-model';
import {evaluateRawLand,rawLandSchema} from './raw-land';
function compare(actual:unknown,expected:unknown){
 if(typeof expected==='number'){expect(actual).toBeCloseTo(expected,6);return;}
 if(expected===null){expect(actual).toBeNull();return;}
 if(Array.isArray(expected)){expect(actual).toHaveLength(expected.length);expected.forEach((v,i)=>compare((actual as unknown[])[i],v));return;}
 for(const [key,value] of Object.entries(expected as object))compare((actual as Record<string,unknown>)[key],value);
}
it.each(golden.water)('retains independently calculated original water golden outputs',({input,expected})=>compare(evaluateWater(waterModelSchema.parse(input)),expected));
it.each(golden.land)('retains independently calculated original land golden outputs',({input,expected})=>compare(evaluateRawLand(rawLandSchema.parse(input)),expected));
