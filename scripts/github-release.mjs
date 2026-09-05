import { spawnSync } from 'node:child_process';
const mode=process.argv[2]??'status';
if(!['status','rename','runs','dispatch','upload'].includes(mode))throw new Error('Use status, rename, runs, dispatch, or upload');
const credential=spawnSync('git',['-c','credential.interactive=never','credential','fill'],{
  input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},
});
if(credential.status!==0)throw new Error('GitHub 凭据不可用，请先登录 GitHub 的 Git 凭据管理器。');
const fields=Object.fromEntries(credential.stdout.trim().split(/\r?\n/).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
if(!fields.password)throw new Error('GitHub 凭据缺少访问令牌。');
async function api(path,method='GET',body){
 const response=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+fields.password,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
 return response.status===204?null:response.json();
}
if(mode==='status') {
 const repo=await api('/repos/rhys-3/destined-journey-summarizer');
 console.log(JSON.stringify({name:repo.full_name,admin:repo.permissions?.admin,defaultBranch:repo.default_branch}));
}
if(mode==='rename') {
 const repo=await api('/repos/rhys-3/destined-journey-summarizer','PATCH',{name:'destined-journey-assistant',description:'命定之诗预设设置与聊天总结助手'});
 console.log(JSON.stringify({name:repo.full_name,url:repo.html_url}));
}
if(mode==='dispatch') {
 await api('/repos/rhys-3/destined-journey-assistant/actions/workflows/ci.yaml/dispatches','POST',{ref:'main',inputs:{release:true}});
 console.log('Release workflow dispatched; it will verify before publishing.');
}
if(mode==='runs') {
 const {workflow_runs}=await api('/repos/rhys-3/destined-journey-assistant/actions/runs?per_page=5');
 console.log(JSON.stringify(workflow_runs.map(r=>({id:r.id,event:r.event,status:r.status,conclusion:r.conclusion,head:r.head_sha,url:r.html_url})),null,2));
 if(process.argv[3]) {
   const {jobs}=await api(`/repos/rhys-3/destined-journey-assistant/actions/runs/${Number(process.argv[3])}/jobs`);
   console.log(JSON.stringify(jobs.map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,steps:j.steps.map(s=>({name:s.name,status:s.status,conclusion:s.conclusion}))})),null,2));
 }
}
if(mode==='upload') {
 const {readFile}=await import('node:fs/promises');
 const {basename}=await import('node:path');
 const file=process.argv[3];if(!file)throw new Error('Asset file required');
 const name=basename(file), release=await api('/repos/rhys-3/destined-journey-assistant/releases/tags/v3.0.0');
 if(release.assets.some(a=>a.name===name))throw new Error('Asset already exists; refusing to overwrite');
 const response=await fetch(release.upload_url.split('{')[0]+'?name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Bearer '+fields.password,'Content-Type':name.endsWith('.json')?'application/json':'application/octet-stream'},body:await readFile(file)});
 if(!response.ok)throw new Error('Asset upload HTTP '+response.status);
 console.log(JSON.stringify({url:(await response.json()).browser_download_url}));
}
