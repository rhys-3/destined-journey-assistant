const fs=require('node:fs'),Module=require('node:module');
let source=fs.readFileSync('tests/ui/test-ui.cjs','utf8').replace('exportConfigurations, importConfigurations,','exportConfigurations, exportRecoverableConfigurations, importConfigurations,');
const start=source.indexOf('console.log(await evaluate'),end=source.indexOf("await cdp('Browser.close');",start);
source=source.slice(0,start)+`const environment=await evaluate('({secure:isSecureContext,uuid:typeof crypto.randomUUID,random:typeof crypto.getRandomValues})');
assert.deepEqual(environment,{secure:false,uuid:'undefined',random:'function'});
fs.writeFileSync('.ui-review/http-uuid-results.json',JSON.stringify(environment,null,2));
console.log('真实 HTTP 页面环境',environment);
await require('./assistant-tests.cjs')(cdp,evaluate);
const bundleUrl='data:text/javascript;base64,'+fs.readFileSync('dist/destined-journey-assistant.js').toString('base64');
await evaluate('globalThis.__destinedJourneyAssistant.destroy();');
await evaluate('import('+JSON.stringify(bundleUrl)+').then(() => globalThis.__destinedJourneyAssistant.open())');
assert(await evaluate('!!globalThis.__destinedJourneyAssistant && document.querySelectorAll("[id^=destined-settings-]").length === 1'));
console.log('发布 ESM 产物实际导入与启动通过');
\n`+source.slice(end);
source=source.replaceAll('.ui-review/preview.html','.ui-review/assistant-preview.html').replace("path.resolve('.ui-review/chrome-profile')","path.resolve('.ui-review/chrome-assistant-profile')");
// A non-loopback hostname makes Chrome enforce real insecure-context API exposure.
source=source.replace('const browser=spawn(',`const httpServer=require('node:http').createServer((request,response)=>{
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(fs.readFileSync('.ui-review/assistant-preview.html'));
});
await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve);});
const browser=spawn(`)
  .replace("['--headless=new',","['--headless=new','--no-proxy-server','--host-resolver-rules=MAP dja-uuid.test 127.0.0.1',")
  .replace("'file:///'+path.resolve('.ui-review/assistant-preview.html').replaceAll('\\\\','/')","'http://dja-uuid.test:'+httpServer.address().port+'/'")
  .replace('finally{clearTimeout(watchdog);','finally{httpServer.closeAllConnections();httpServer.close();clearTimeout(watchdog);');
const runner=new Module(__filename,module);runner.filename=__filename;runner.paths=module.paths;runner._compile(source,__filename);
