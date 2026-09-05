const fs=require('node:fs'),Module=require('node:module');
let source=fs.readFileSync('tests/ui/test-ui.cjs','utf8');
const start=source.indexOf('console.log(await evaluate'),end=source.indexOf('for(const [name,width,height,tab]');
if(start<0||end<start)throw Error('Harness markers changed');
source=source.slice(0,start)+`const result=await evaluate(fs.readFileSync('tests/ui/configuration-tests.txt','utf8'));console.log(result);fs.writeFileSync('.ui-review/configuration-test-results.json',JSON.stringify(result,null,2));\n`+source.slice(end);
source=source.replaceAll('.ui-review/preview.html','.ui-review/configuration-preview.html').replace("path.resolve('.ui-review/chrome-profile')","path.resolve('.ui-review/chrome-config-profile')");
const runner=new Module(__filename,module);runner.filename=__filename;runner.paths=module.paths;runner._compile(source,__filename);
