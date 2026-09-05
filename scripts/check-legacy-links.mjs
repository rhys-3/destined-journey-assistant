import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const phase=process.argv[2]??'check';
const hash=value=>createHash('sha256').update(String(value).replace(/\r\n/g,'\n').trim()).digest('hex');
const cases=['v2.7.0','v2.8.2','v2.8.3','main','latest','unversioned'];
const results=await Promise.all(cases.map(async ref=>{
  const url=`https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-summarizer${ref==='unversioned'?'':'@'+ref}/dist/destined-journey-summarizer.js`;
  const expected=execFileSync('git',['show',`${ref.startsWith('v')?ref:'v2.8.3'}:dist/destined-journey-summarizer.js`],{encoding:'utf8',windowsHide:true,maxBuffer:5*1024*1024});
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    const body=await response.text();
    return {ref,url,status:response.status,unchanged:response.ok&&hash(body)===hash(expected),sha256:hash(body)};
  }catch(error){return{ref,url,error:error.message,unchanged:false};}
}));
await mkdir('.ui-review',{recursive:true});
await writeFile(`.ui-review/legacy-links-${phase}.json`,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
if(results.some(r=>!r.unchanged))process.exitCode=1;
