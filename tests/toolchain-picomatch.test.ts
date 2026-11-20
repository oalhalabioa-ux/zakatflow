import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it('bounds repeated wildcard matching in the development toolchain',()=>{
 const result=spawnSync(process.execPath,['-e',`
  const assert=require('node:assert/strict');
  // The postinstall guard rejects repeated extglobs before regex generation.
  require('./scripts/guard-picomatch.cjs')(true);
  const match=require('picomatch');
  assert.equal(match.isMatch('tests/feasibility.e2e.test.ts','tests/*.e2e.test.ts'),true);
  assert.equal(match.isMatch('tests/feasibility.test.ts','tests/*.e2e.test.ts'),false);
 `],{timeout:2000,encoding:'utf8'});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
});
