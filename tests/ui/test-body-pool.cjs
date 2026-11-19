// Real assistant runtime with simulated host/storage APIs; no Tavern/model calls.
const fs = require('node:fs'), Module = require('node:module');
let source = fs.readFileSync('tests/ui/test-ui.cjs', 'utf8');
const marker = 'if (modernLength) {';
if (!source.includes(marker)) throw Error('Harness fixture marker changed');
source = source.replace(marker, `{
 const id='6da2d345-4920-452a-bee1-6e1b5af91001';
 const anchor=preset.prompts.findIndex(p=>p.id==='15a38201-7025-4b2c-b0df-d9eba7147bd2');
 preset.prompts.splice(anchor<0?preset.prompts.length:anchor+1,0,{id,identifier:id,name:'🧩 体型随机',enabled:true,role:'system',system_prompt:false,marker:false,position:{type:'relative'},
  content:'<体型池>\\n女性: <|女性体型池|>\\n男性: <|男性体型池|>\\n</体型池>',
  extra:{destined_ui:{control:'toggle',order:100,protected:false,section:'narrative',version:1}}});
}
${marker}`);
const start = source.indexOf('console.log(await evaluate'), end = source.indexOf("await cdp('Browser.close');", start);
if (start < 0 || end < start) throw Error('Harness run markers changed');
const run = async (cdp, evaluate) => {
 const id = '6da2d345-4920-452a-bee1-6e1b5af91001';
 const q = selector => `ui.shadow.querySelector(${JSON.stringify(selector)})`;
 const slider = (group, option) => q(`[data-action="body-pool-weight"][data-group="${group}"][data-option="${option}"]`);
 const tab = await evaluate(`(()=>{for(const tab of [...ui.shadow.querySelectorAll('[data-action=tab]')].map(b=>b.dataset.tab)){ui.state.activeTab=tab;ui.render();if(ui.shadow.querySelector('[data-body-pool]'))return tab;}return '';})()`);
 assert(tab, 'body pool controls must appear on a settings page');
 assert(await evaluate(`${q(`[data-placement-id="${id}"] [data-body-pool]`)}&&!${q('[data-body-pool]')}.open&&ui.shadow.querySelectorAll('[data-action=body-pool-weight]').length===17`));
 await evaluate(`(()=>{const d=${q('[data-body-pool]')};d.open=true;d.dispatchEvent(new Event('toggle'));ui.render();})()`);
 assert(await evaluate(`${q('[data-body-pool]')}.open`), 'disclosure stays open across renders');

 // Dragging refreshes the group's shares only; the stored weights stay untouched.
 const before = await evaluate('JSON.stringify(vars.managed_values?.body_pool??null)');
 await evaluate(`(()=>{window.dragNode=${slider('male_build', '魁梧')};for(let n=3;n<=9;n++){dragNode.value=n;dragNode.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
 assert(await evaluate(`dragNode===${slider('male_build', '魁梧')}&&dragNode.parentElement.querySelector('output').textContent==='38%'&&dragNode.getAttribute('aria-valuetext')==='权重 9，约 38%'`));
 assert.equal(await evaluate('JSON.stringify(vars.managed_values?.body_pool??null)'), before);
 await evaluate(`dragNode.dispatchEvent(new Event('change',{bubbles:true}))`);
 await evaluate('ui.settle()');
 assert(await evaluate(`vars.managed_values.body_pool.male_build.魁梧===9&&${slider('male_build', '魁梧')}.value==='9'`));

 // A group cannot lose every option; the rejected value reverts on screen.
 for (const option of ['平坦', '小巧', '适中', '丰满']) {
  await evaluate(`(()=>{const s=${slider('female_bust', option)};s.value=0;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate('ui.settle()');
 }
 await evaluate(`(()=>{const s=${slider('female_bust', '巨乳')};s.value=0;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await evaluate('ui.settle()');
 assert(await evaluate(`vars.managed_values.body_pool.female_bust.巨乳===1&&${slider('female_bust', '巨乳')}.value==='1'&&${q('[data-body-pool-error]')}.textContent.includes('至少保留一项')`));
 await evaluate(`${q('[data-action=body-pool-reset]')}.click()`);
 await evaluate('ui.settle()');
 assert(await evaluate(`vars.managed_values.body_pool.female_bust.适中===4&&vars.managed_values.body_pool.male_build.魁梧===3&&${slider('female_bust', '适中')}.value==='4'&&!${q('[data-body-pool-error]')}.textContent`));

 for (const [width, height] of [[1280, 960], [390, 844], [320, 640]]) {
  const mobile = width < 720;
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await evaluate(`ui.state.activeTab=${JSON.stringify(tab)};ui.render();${q('[data-body-pool]')}.scrollIntoView({block:'start'})`);
  // Rendering restores the previous scroll position on the next frame; scroll after it.
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{${q('[data-placement-id="' + id + '"]')}.scrollIntoView({block:'start'});r();})))`);
  const layout = await evaluate(`(()=>{const c=ui.shadow.querySelector('.content'),e=${q('[data-body-pool]')},r=e.getBoundingClientRect(),p=ui.shadow.querySelector('.panel').getBoundingClientRect();return{tab:ui.state.activeTab,top:Math.round(r.top),overflow:c.scrollWidth>c.clientWidth+1||e.scrollWidth>e.clientWidth+1,outside:r.left<p.left-1||r.right>p.right+1}})()`);
  assert(!layout.overflow && !layout.outside, JSON.stringify(layout));
  const controls = await evaluate(`(() => {
   const pool = ${q('[data-body-pool]')};
   const sliders = [...pool.querySelectorAll('input[type=range]')];
   const options = [...pool.querySelectorAll('[data-body-pool-group]:first-child .body-pool-option')];
   return {
    sliders: sliders.length,
    shares: pool.querySelectorAll('[data-body-pool-share]').length,
    buttons: [...pool.querySelectorAll('button')].map(button => button.dataset.action),
    editable: !!pool.querySelector('input:not([type=range]), textarea, [contenteditable=true]'),
    columns: new Set(options.map(option => option.getBoundingClientRect().left)).size,
    minSliderHeight: Math.min(...sliders.map(input => input.getBoundingClientRect().height)),
    minRightSpace: Math.min(...sliders.map(input => input.closest('.body-pool-option').getBoundingClientRect().right - input.getBoundingClientRect().right)),
   };
  })()`);
  assert(controls.sliders === 17 && controls.shares === 17 && !controls.editable, JSON.stringify(controls));
  assert.deepEqual(controls.buttons, ['body-pool-reset']);
  if (mobile) {
   assert(controls.columns === 1 && controls.minSliderHeight >= 44 && controls.minRightSpace >= 44, JSON.stringify(controls));
  } else {
   assert(controls.columns > 1, JSON.stringify(controls));
  }
  console.log('body-pool layout', width, JSON.stringify({ ...layout, ...controls }));
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('.ui-review/body-pool-' + width + '.png', Buffer.from(shot.data, 'base64'));

  if (mobile) {
   const touch = (type, x, y) => cdp('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
   const input = slider('female_build', '骨感');
   const range = await evaluate(`(() => {
    const input = ${input};
    const rect = input.getBoundingClientRect();
    return { from: rect.left + 8 + (rect.width - 16) * .1, to: rect.left + rect.width * .75, y: (rect.top + rect.bottom) / 2 };
   })()`);
   await touch('touchStart', range.from, range.y);
   await touch('touchMove', (range.from + range.to) / 2, range.y);
   await touch('touchMove', range.to, range.y);
   await touch('touchEnd');
   await evaluate('ui.settle()');
   const adjusted = await evaluate(`({ weight: ${input}.valueAsNumber, saved: vars.managed_values.body_pool.female_build.骨感 })`);
   assert(adjusted.weight > 1 && adjusted.saved === adjusted.weight, `${width}px range still adjusts and saves the weight: ${JSON.stringify(adjusted)}`);

   const start = await evaluate(`(() => {
    const input = ${input}, sliderRect = input.getBoundingClientRect();
    const row = input.closest('.body-pool-option');
    const x = (sliderRect.right + row.getBoundingClientRect().right) / 2;
    const y = (sliderRect.top + sliderRect.bottom) / 2;
    const hit = ui.shadow.elementFromPoint(x, y);
    return { x, y, scroll: ${q('.content')}.scrollTop, weight: input.value,
     passive: row.contains(hit) && !hit.closest('label, input, button, a, textarea, select') };
   })()`);
   assert(start.passive, `${width}px right swipe starts outside an interactive control`);
   const saved = await evaluate('JSON.stringify(vars.managed_values.body_pool)');
   const direction = width === 320 ? 1 : -1;
   await touch('touchStart', start.x, start.y);
   for (let distance = 30; distance <= 150; distance += 30) await touch('touchMove', start.x, start.y + direction * distance);
   await touch('touchEnd');
   assert(await evaluate(`new Promise(r=>requestAnimationFrame(()=>r((${start.scroll} - ${q('.content')}.scrollTop) * ${direction} > 40)))`), `${width}px right swipe scrolls the panel`);
   assert.equal(await evaluate(`${input}.value`), start.weight);
   assert.equal(await evaluate('JSON.stringify(vars.managed_values.body_pool)'), saved);

   await evaluate(`${q('[data-action=body-pool-reset]')}.click()`);
   await evaluate('ui.settle()');
  }
 }
 await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
 await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, screenWidth: 1280, screenHeight: 960, deviceScaleFactor: 1, mobile: false });

 // Turning the entry off hides the weights; turning it on restores them.
 await evaluate(`ui.state.activeTab=${JSON.stringify(tab)};ui.render();${q(`[data-key="prompt:${id}"]`)}.click()`);
 await evaluate('ui.settle()');
 assert(await evaluate(`!${q('[data-body-pool]')}&&ui.state.preset.prompts.find(p=>p.id===${JSON.stringify(id)}).enabled===false`));
 await evaluate(`${q(`[data-key="prompt:${id}"]`)}.click()`);
 await evaluate('ui.settle()');
 assert(await evaluate(`!!${q('[data-body-pool]')}`));
 console.log('体型比例 UI：滑条调权、松手保存、全零拒绝并回退、恢复默认、条目开关、三宽度布局及手机侧边滑动通过（模拟宿主）');
};
source = source.slice(0, start) + `await (${run.toString()})(cdp,evaluate);\n` + source.slice(end);
source = source.replaceAll('.ui-review/preview.html', '.ui-review/body-pool-preview.html').replace("path.resolve('.ui-review/chrome-profile')", "path.resolve('.ui-review/chrome-body-pool-profile')");
const runner = new Module(__filename, module); runner.filename = __filename; runner.paths = module.paths; runner._compile(source, __filename);
