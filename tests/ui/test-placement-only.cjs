const fs=require('node:fs'),Module=require('node:module');
let source=fs.readFileSync('tests/ui/test-ui.cjs','utf8');
const start=source.indexOf('console.log(await evaluate'),end=source.indexOf('for(const [name,width,height,tab]');
if(start<0||end<start)throw Error('Harness markers changed');
source=source.slice(0,start)+`const results=await evaluate(fs.readFileSync('tests/ui/placement-tests.txt','utf8'));console.log(results);fs.writeFileSync('.ui-review/placement-test-results.json',JSON.stringify(results,null,2));const sync=await evaluate(fs.readFileSync('tests/ui/entry-sync-tests.txt','utf8'));console.log(sync);fs.writeFileSync('.ui-review/entry-sync-results.json',JSON.stringify(sync,null,2));console.log(await require('./placement-layout-tests.cjs')(cdp,evaluate));\n`+source.slice(end);
source=source.replaceAll('.ui-review/preview.html','.ui-review/placement-preview.html').replace("path.resolve('.ui-review/chrome-profile')","path.resolve('.ui-review/chrome-placement-profile')");
const runner=new Module(__filename,module);runner.filename=__filename;runner.paths=module.paths;runner._compile(source,__filename);
