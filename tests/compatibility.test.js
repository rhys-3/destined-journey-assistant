import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('the old public bundle stays byte-equivalent to v2.8.3 for main/latest users',async()=>{
  const old=await readFile(new URL('../dist/destined-journey-summarizer.js',import.meta.url),'utf8');
  const hash=createHash('sha256').update(old.replace(/\r\n/g,'\n').trim()).digest('hex');
  assert.equal(hash,'1d5df8e5376ed1b313e8aee03d9f2d3c5dedef24e05b5f98f240fc64fe71dd1e');
});
test('the loader pins its version and only retries the same asset',async()=>{
  const loader=await readFile(new URL('../loader.js',import.meta.url),'utf8');
  assert(loader.includes(`const version = '${version}'`));
  assert(loader.includes('destined-journey-assistant@v${version}/dist/destined-journey-assistant.js'));
  assert(!loader.includes('@main')&&!loader.includes('@latest'));
});
test('a failed loader reports the version and retries the same version once clicked',async()=>{
  const loader=(await readFile(new URL('../loader.js',import.meta.url),'utf8')).replace(/\bimport\(/g,'importModule(');
  const urls=[],errors=[];let buttons=[{name:'existing',visible:true}],retry,stopped=false;
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('importModule','toastr','updateScriptButtonsWith','eventOn','getButtonEvent','console',loader)(
    async url=>{urls.push(url);if(urls.length===1)throw Error('network unavailable');},
    {error:message=>errors.push(message)}, fn=>{buttons=fn(buttons);}, (_,fn)=>{retry=fn;return{stop(){stopped=true;}};},name=>name,{error(){}}
  );
  assert(errors[0].includes(`v${version}`)&&errors[0].includes('network unavailable'));assert.equal(buttons.length,2);
  await retry();assert.equal(urls[1],urls[0]+'?retry=1');assert(stopped);assert.deepEqual(buttons,[{name:'existing',visible:true}]);
});
