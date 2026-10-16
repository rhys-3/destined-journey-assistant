import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { FLAVORS } from './src/flavor.js';
const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
await mkdir('dist',{recursive:true});
// One runtime source, one bundle per flavor; the flavor only selects identifiers and storage.
for(const flavor of Object.values(FLAVORS)){
  await build({entryPoints:['src/index.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:flavor.output,minify:true,legalComments:'none',define:{__ASSISTANT_FLAVOR__:JSON.stringify(flavor),__ASSISTANT_FLAVOR_INJECTED__:'"1"'},banner:{js:JSON.stringify(flavor.scriptName+' v'+pkg.version)+';'}});
  console.log(flavor.scriptName+' v'+pkg.version+' 构建完成 -> '+flavor.output);
}
