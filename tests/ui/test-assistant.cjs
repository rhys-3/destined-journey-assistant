const fs=require('node:fs'),Module=require('node:module');
const { version } = require('../../package.json');
const bundlePath = `/gh/rhys-3/destined-journey-assistant@v${version}/dist/destined-journey-assistant.js`;
const primary = 'https://cdn.jsdelivr.net' + bundlePath;
const fallback = 'https://testingcf.jsdelivr.net' + bundlePath;

async function importRelease(primary, fallback) {
  const fetchFromHost = globalThis.fetch;
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const requests = [], created = [], revoked = [];
  const oldAssistant = globalThis.__destinedJourneyAssistant;
  const beforeErrors = window.errors.length;
  globalThis.fetch = (url, options) => {
    if (url !== primary && url !== fallback) return fetchFromHost(url, options);
    requests.push({ url, aborted: options.signal.aborted });
    return fetchFromHost('/bundle.js', options);
  };
  URL.createObjectURL = blob => {
    const url = create(blob);
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = url => {
    revoked.push(url);
    revoke(url);
  };
  try {
    await import(location.origin + '/loader.js');
    const assistant = globalThis.__destinedJourneyAssistant;
    assistant.open();
    return {
      requests, created, revoked,
      started: assistant !== oldAssistant,
      panels: document.querySelectorAll('[id^=destined-settings-]').length,
      errors: window.errors.slice(beforeErrors),
    };
  } finally {
    globalThis.fetch = fetchFromHost;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
}

let source=fs.readFileSync('tests/ui/test-ui.cjs','utf8');
const start=source.indexOf('console.log(await evaluate'),end=source.indexOf("await cdp('Browser.close');",start);
source=source.slice(0,start)+`const environment=await evaluate('({secure:isSecureContext,uuid:typeof crypto.randomUUID,random:typeof crypto.getRandomValues})');
assert.deepEqual(environment,{secure:false,uuid:'undefined',random:'function'});
fs.writeFileSync('.ui-review/http-uuid-results.json',JSON.stringify(environment,null,2));
console.log('真实 HTTP 页面环境',environment);
await require('./assistant-tests.cjs')(cdp,evaluate);
const release=await evaluate(${JSON.stringify(`(${importRelease})(${JSON.stringify(primary)}, ${JSON.stringify(fallback)})`)});
assert.deepEqual(release.requests,[{url:${JSON.stringify(primary)},aborted:false}]);
assert.deepEqual(release.errors,[]);
assert.equal(release.started,true);
assert.equal(release.panels,1);
assert.equal(release.created.length,1);
assert.match(release.created[0],/^blob:/);
assert.deepEqual(release.revoked,release.created);
console.log('发布加载器通过实际 Blob URL 导入 ESM 产物，完成一次初始化并释放 URL');
\n`+source.slice(end);
source=source.replaceAll('.ui-review/preview.html','.ui-review/assistant-preview.html').replace("path.resolve('.ui-review/chrome-profile')","path.resolve('.ui-review/chrome-assistant-profile')");
// A non-loopback hostname makes Chrome enforce real insecure-context API exposure.
source=source.replace('const browser=spawn(',`const httpServer=require('node:http').createServer((request,response)=>{
  if (request.url === '/loader.js' || request.url === '/bundle.js') {
    response.setHeader('Content-Type','application/javascript; charset=utf-8');
    response.end(fs.readFileSync(request.url === '/loader.js' ? 'loader.js' : 'dist/destined-journey-assistant.js'));
    return;
  }
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(fs.readFileSync('.ui-review/assistant-preview.html'));
});
await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve);});
const browser=spawn(`)
  .replace("['--headless=new',","['--headless=new','--no-proxy-server','--host-resolver-rules=MAP dja-uuid.test 127.0.0.1',")
  .replace("'file:///'+path.resolve('.ui-review/assistant-preview.html').replaceAll('\\\\','/')","'http://dja-uuid.test:'+httpServer.address().port+'/'")
  .replace('finally{clearTimeout(watchdog);','finally{httpServer.closeAllConnections();httpServer.close();clearTimeout(watchdog);');
const runner=new Module(__filename,module);runner.filename=__filename;runner.paths=module.paths;runner._compile(source,__filename);
