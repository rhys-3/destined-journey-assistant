module.exports = async (cdp, evaluate) => {
  const fs = require('node:fs'), assert = require('node:assert/strict'), results = [];
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/nsfw-section.json', 'utf8'));
  const run = code => evaluate('(async()=>{' + code + '})()');
  const check = async (name, expression) => { assert(await run('return (' + expression + ');'), name); results.push(name); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const theme = value => run(`ui.state.activeTab='settings';ui.render();const input=ui.shadow.querySelector('[data-action="ui-theme"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));ui.state.activeTab='style';ui.render();`);
  const size = async (width, height) => {
    const mobile = Math.min(width, height) < 720;
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile });
    await pause(90);
  };
  const click = async selector => {
    await pause(70);
    const point = await run(`const n=ui.shadow.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing control');n.scrollIntoView({block:'center'});await new Promise(requestAnimationFrame);const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=ui.shadow.elementFromPoint(x,y);if(!hit||!(hit===n||n.contains(hit)))throw Error('Control is obscured: '+${JSON.stringify(selector)});return {x,y};`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await run('await ui.settle();');
  };
  const modeIds = fixture.prompts.filter(p => p.extra.destined_ui.block === 'nsfw-mode').map(p => p.id);
  const extraIds = fixture.prompts.filter(p => p.extra.destined_ui.block === 'nsfw-extra').map(p => p.id);
  assert.equal(modeIds.length, 4);
  assert(fixture.prompts.filter(p => modeIds.includes(p.id)).every(p => p.extra.destined_ui.group === 'nsfw-mode'));
  const mode = id => '.nsfw-modes [data-action="group"][data-value="' + id + '"]';
  const toggle = id => '.nsfw-options [data-key="prompt:' + id + '"]';
  await size(1280, 960);
  await run(`
    ui.closePromptEditor(true);await ui.settle();
    window.__nsfwOriginal={data:structuredClone(data),stored:structuredClone(stored),vars:structuredClone(vars),config:structuredClone(ui.state.config),tab:ui.state.activeTab,disclosures:[...ui.state.disclosures],unlocked:ui.state.editorUnlocked,theme:ui.shadow.querySelector('.destined-root').dataset.theme};
    window.__nsfwFixture=${JSON.stringify(fixture)};
    const remove=new Set([...ui.getGroupOptions('nsfw-mode').map(([id])=>id),...__nsfwFixture.prompts.map(p=>p.id)]);
    const at=data.prompts.findIndex(p=>remove.has(p.id));
    data.prompts=data.prompts.filter(p=>!remove.has(p.id));
    data.prompts.splice(at,0,...structuredClone(__nsfwFixture.prompts));
    data.extensions.destined_author=ui.defaultAuthorLayout();
    for(const block of __nsfwFixture.blocks){const index=data.extensions.destined_author.blocks.findIndex(b=>b.id===block.id);data.extensions.destined_author.blocks[index]=structuredClone(block);}
    stored=structuredClone(data);window.__nsfwLoaded=structuredClone(data);
    window.__nsfwContent=JSON.stringify(data.prompts.map(p=>[p.id,p.content,p.position]));
    ui.reconcilePreset('adult fixture');ui.state.activeTab='style';ui.state.editorUnlocked=false;ui.state.disclosures.clear();ui.render();await ui.settle();
  `);
  try {
    await check('四个模式按实际单选组渲染，附加项为三个独立开关', `ui.getGroupOptions('nsfw-mode').length===4&&ui.shadow.querySelectorAll('.nsfw-modes [data-action="group"]').length===4&&ui.shadow.querySelectorAll('.nsfw-options input').length===3`);
    await check('模式和附加描写共用一个区域，收起时显示当前选择', `ui.shadow.querySelectorAll('[data-disclosure="nsfw-mode"]').length===1&&!ui.shadow.querySelector('[data-disclosure="nsfw-extra"]')&&!ui.shadow.querySelector('[data-disclosure="nsfw-mode"]').open&&ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary').textContent.includes('通用 · 附加描写 0/3')`);
    await check('外层标签不显示为设置卡片，也没有可关闭开关', `[ui.IDS.nsfwStart,ui.IDS.nsfwEnd].every(id=>ui.PROTECTED_IDS.has(id)&&!ui.shadow.querySelector('[data-placement-id="'+id+'"]')&&!ui.shadow.querySelector('[data-key="prompt:'+id+'"]'))`);
    await run(`for(const p of data.prompts){if(__nsfwFixture.prompts.some(f=>f.id===p.id&&f.extra.destined_ui.block==='nsfw-mode')){p.extra.destined_ui.group='';p.enabled=[ui.IDS.nsfwGeneral,ui.IDS.nsfwMale].includes(p.id);}}data.prompts.find(p=>p.id===ui.IDS.nsfwSfw).enabled=true;stored=structuredClone(data);ui.reconcilePreset('legacy blank adult groups');ui.render();`);
    await check('已导入的空单选组元数据仍显示四张选择卡且没有模式开关', `ui.getGroupOptions('nsfw-mode').length===4&&ui.shadow.querySelectorAll('.nsfw-modes [data-action="group"]').length===4&&!ui.shadow.querySelector('.nsfw-modes input')`);
    await check('旧数据同时开启两个模式时明确提示重新选择', `ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary').textContent.includes('已选多个模式')`);
    await click('[data-disclosure="nsfw-mode"] > summary');
    await click(mode(modeIds[2]));
    await check('旧空组数据点击后仅保存一个模式并保留附加选择与正文', `ui.getGroupOptions('nsfw-mode').filter(([id])=>stored.prompts.find(p=>p.id===id).enabled).length===1&&stored.prompts.find(p=>p.id===ui.IDS.nsfwFemale).enabled&&stored.prompts.find(p=>p.id===ui.IDS.nsfwSfw).enabled&&JSON.stringify(data.prompts.map(p=>[p.id,p.content,p.position]))===__nsfwContent`);
    await run(`delete data.prompts.find(p=>p.id===ui.IDS.nsfwGeneral).extra.destined_ui.group;data.prompts.find(p=>p.id===ui.IDS.nsfwMale).extra.destined_ui.group='nsfw-mode';stored=structuredClone(data);ui.reconcilePreset('mixed adult group metadata');ui.render();`);
    await click(mode(modeIds[0]));
    await check('空组、缺失组和正确分组混用时仍互斥保存', `ui.getGroupOptions('nsfw-mode').length===4&&ui.getGroupOptions('nsfw-mode').filter(([id])=>stored.prompts.find(p=>p.id===id).enabled).length===1&&stored.prompts.find(p=>p.id===ui.IDS.nsfwGeneral).enabled`);
    await check('兼容回退不改变自定义分组、移动条目或新增独立开关', `(()=>{const p=structuredClone(data.prompts.find(p=>p.id===ui.IDS.nsfwGeneral));p.extra.destined_ui.group='custom-mode';if(ui.getPromptGroupId(p)!=='custom-mode')return false;p.extra.destined_ui.group='';p.extra.destined_ui.block='nsfw-extra';if(ui.getPromptGroupId(p)!==null)return false;p.extra.destined_ui.block='nsfw-mode';p.id='custom-independent-nsfw';return ui.getPromptGroupId(p)===null;})()`);
    await run(`data=structuredClone(__nsfwLoaded);stored=structuredClone(data);ui.reconcilePreset('restore current adult metadata');ui.render();`);
    for (const id of modeIds) {
      await click(mode(id));
      await check('点击模式互斥保存并同步可访问状态 ' + id, `ui.getGroupOptions('nsfw-mode').filter(([id])=>stored.prompts.find(p=>p.id===id).enabled).length===1&&stored.prompts.find(p=>p.id==='${id}').enabled&&data.prompts.find(p=>p.id==='${id}').enabled&&ui.shadow.querySelector(${JSON.stringify(mode(id))}).getAttribute('aria-pressed')==='true'`);
    }
    for (const id of extraIds) {
      await click(toggle(id));
      await check('附加描写独立保存 ' + id, `stored.prompts.find(p=>p.id==='${id}').enabled&&data.prompts.find(p=>p.id==='${id}').enabled`);
    }
    await check('防发情模式下附加开关可用，摘要与展开状态正确', `stored.prompts.find(p=>p.id===ui.IDS.nsfwGuard).enabled&&[...ui.shadow.querySelectorAll('.nsfw-options input')].every(n=>n.checked&&!n.disabled)&&ui.shadow.querySelector('[data-disclosure="nsfw-mode"]').open&&ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary').textContent.includes('防发情 · 附加描写 3/3')`);
    await click(mode(modeIds[1]));
    await check('切换模式保留三个附加选项，且不改正文及发送顺序', `[ui.IDS.nsfwSfw,ui.IDS.nsfwPace,ui.IDS.nsfwWords].every(id=>stored.prompts.find(p=>p.id===id).enabled)&&JSON.stringify(data.prompts.map(p=>[p.id,p.content,p.position]))===__nsfwContent`);
    await run(`for(const p of data.prompts){if(ui.getPromptGroupId(p)==='nsfw-mode')p.enabled=p.id===ui.IDS.nsfwFemale;}data.prompts.find(p=>p.id===ui.IDS.nsfwSfw).enabled=false;stored=structuredClone(data);ui.reconcilePreset('native adult changes');await ui.settle();`);
    await check('原生列表修改同步回界面的模式和附加项摘要', `ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary').textContent.includes('女性向 · 附加描写 2/3')&&ui.shadow.querySelector(${JSON.stringify(mode(modeIds[2]))}).getAttribute('aria-pressed')==='true'&&!ui.shadow.querySelector(${JSON.stringify(toggle(extraIds[0]))}).checked`);
    await run(`window.__nsfwSaved=JSON.stringify(stored);window.failWrite='in_use';`);
    await click(mode(modeIds[0]));
    await check('模式保存失败时回滚原选择并显示失败状态', `JSON.stringify(stored)===__nsfwSaved&&ui.state.saveState==='error'&&ui.shadow.querySelector(${JSON.stringify(mode(modeIds[2]))}).getAttribute('aria-pressed')==='true'`);
    await run(`data.prompts.find(p=>p.id===ui.IDS.nsfwMale).enabled=true;stored=structuredClone(data);ui.reconcilePreset('multiple native choices');ui.render();`);
    await check('原生多选异常不会伪装成正常单选', `ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary').textContent.includes('已选多个模式')`);
    await click(mode(modeIds[3]));
    await check('重新选择一次即可恢复互斥', `ui.getGroupOptions('nsfw-mode').filter(([id])=>data.prompts.find(p=>p.id===id).enabled).length===1`);
    await run(`for(const [id] of ui.getGroupOptions('nsfw-mode'))data.prompts.find(p=>p.id===id).enabled=false;stored=structuredClone(data);ui.reconcilePreset('no native choice');ui.render();`);
    await check('未选择模式时明确显示待选择', `ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary').textContent.includes('请选择模式')`);
    await click(mode(modeIds[0]));
    await run(`ui.state.editorUnlocked=true;ui.render();`);
    await click('[data-placement-id="' + modeIds[2] + '"] [data-action="entry-edit"]');
    await check('编辑入口直接定位模式正文并保留原单选关系', `ui.state.promptEditor.id===ui.IDS.nsfwFemale&&ui.state.promptEditor.draft.content==='界面测试正文 3'`);
    await run(`ui.setEditorField('description:description','自定义简介 <b>按偏好调整</b>');await ui.savePromptEditor();await ui.settle();`);
    await check('模式简介可编辑且转义，保存不改变正文与分组', `ui.shadow.querySelector(${JSON.stringify(mode(modeIds[2]))}).textContent.includes('自定义简介 <b>按偏好调整</b>')&&!ui.shadow.querySelector('.nsfw-modes b')&&ui.getPromptGroupId(data.prompts.find(p=>p.id===ui.IDS.nsfwFemale))==='nsfw-mode'&&JSON.stringify(data.prompts.map(p=>[p.id,p.content,p.position]))===__nsfwContent`);
    await click('[data-action="entry-new-here"][data-block="nsfw-extra"]');
    await check('新增附加描写默认独立开关', `ui.state.promptEditor.draft.controlType==='toggle'`);
    await run(`ui.setEditorField('name','自定义附加描写');ui.setEditorField('content','独立的测试规则');window.__nsfwAdded=await ui.savePromptEditor();await ui.settle();`);
    await check('新增附加条目位于结束标签之前', `data.prompts.findIndex(p=>p.id===__nsfwAdded)+1===data.prompts.findIndex(p=>p.id===ui.IDS.nsfwEnd)&&ui.getPromptGroupId(data.prompts.find(p=>p.id===__nsfwAdded))===null`);
    await run(`ui.openPromptEditor(ui.IDS.nsfwStart);`);
    await check('结构条目可阅读编辑，但不能删除或停用', `!ui.shadow.querySelector('[data-action="entry-delete"]')||ui.shadow.querySelector('[data-action="entry-delete"]').disabled`);
    await run(`ui.closePromptEditor(true);const snap=ui.validateSnapshot(JSON.parse(JSON.stringify(ui.captureConfiguration())));window.__nsfwRoundtrip=snap;`);
    await check('配置往返保留模式关系和附加项选择', `__nsfwRoundtrip.prompts.filter(p=>p.extra?.destined_ui?.group==='nsfw-mode').length===4&&__nsfwRoundtrip.prompts.find(p=>p.id===ui.IDS.nsfwPace).enabled`);
    await check('新版配置缺失或停用任一端标签时拒绝导入', `['missing','disabled','unused'].every(kind=>{const snap=structuredClone(__nsfwRoundtrip),end=snap.prompts.find(p=>p.id===ui.IDS.nsfwEnd);if(kind==='disabled')end.enabled=false;else{snap.prompts=snap.prompts.filter(p=>p!==end);if(kind==='unused')snap.prompts_unused.push(end);}try{ui.validateSnapshot(snap);return false;}catch(error){return error.message.includes('起始和结束');}})`);
    await run(`data=structuredClone(__nsfwLoaded);const layout=data.extensions.destined_author;layout.pages.find(p=>p.id==='style').label='自定义文风页';layout.blocks=layout.blocks.filter(b=>b.id!=='nsfw-extra');layout.blocks.find(b=>b.id==='nsfw-mode').label='旧版自定义成人标题';stored=structuredClone(data);ui.reconcilePreset('legacy layout');ui.state.editorUnlocked=false;ui.render();`);
    await check('旧布局补充附加板块时保留自定义页面与标题', `ui.authorLayout().pages.find(p=>p.id==='style').label==='自定义文风页'&&ui.shadow.querySelector('[data-disclosure="nsfw-mode"] summary strong').textContent==='旧版自定义成人标题'&&!!ui.shadow.querySelector('.nsfw-options')`);
    await run(`data.prompts=data.prompts.filter(p=>![ui.IDS.nsfwStart,ui.IDS.nsfwEnd,ui.IDS.nsfwGuard,ui.IDS.nsfwSfw,ui.IDS.nsfwPace,ui.IDS.nsfwWords].includes(p.id));for(const p of data.prompts)if([ui.IDS.nsfwGeneral,ui.IDS.nsfwMale,ui.IDS.nsfwFemale].includes(p.id))delete p.extra;stored=structuredClone(data);ui.reconcilePreset('legacy three modes');ui.render();`);
    await check('旧版三模式仍可使用，不伪造缺失条目或空附加区域', `ui.getGroupOptions('nsfw-mode').length===3&&ui.shadow.querySelectorAll('.nsfw-modes [data-action="group"]').length===3&&!ui.shadow.querySelector('.nsfw-options')&&!data.prompts.some(p=>p.id===ui.IDS.nsfwGuard)`);
    await check('旧版三模式配置仍能保存和导入', `ui.validateSnapshot(JSON.parse(JSON.stringify(ui.captureConfiguration()))).prompts.every(p=>![ui.IDS.nsfwStart,ui.IDS.nsfwEnd].includes(p.id))`);
    await run(`data=structuredClone(__nsfwLoaded);data.extensions.destined_author.blocks.find(b=>b.id==='nsfw-extra').page='daily';stored=structuredClone(data);ui.reconcilePreset('custom adult location');ui.state.activeTab='style';ui.render();`);
    await check('用户移动附加板块后仍按自定义位置显示', `!ui.shadow.querySelector('.nsfw-options')&&ui.shadow.querySelectorAll('.nsfw-modes').length===1`);
    await run(`ui.state.activeTab='daily';ui.render();`);
    await check('移动后的附加板块独立显示且不重复', `ui.shadow.querySelectorAll('.nsfw-options').length===1&&!!ui.shadow.querySelector('[data-disclosure="nsfw-extra"]')&&!ui.shadow.querySelector('.nsfw-modes')`);
    await run(`data=structuredClone(__nsfwLoaded);stored=structuredClone(data);ui.reconcilePreset('adult layout review');ui.state.activeTab='style';ui.state.saveState='idle';ui.state.editorUnlocked=false;ui.state.disclosures.add('nsfw-mode');ui.render();`);
    for (const themeName of ['midnight', 'forest', 'ember', 'parchment']) {
      await theme(themeName);
      for (const [width, height] of [[1280, 960], [390, 844], [320, 640], [844, 390]]) {
        await size(width, height);
        await run('ui.render();');
        await pause(70);
        await run(`const c=ui.shadow.querySelector('.content'),s=ui.shadow.querySelector('[data-disclosure="nsfw-mode"]');c.scrollTop+=s.getBoundingClientRect().top-c.getBoundingClientRect().top-6;`);
        await pause(90);
        const metrics = await run(`const c=ui.shadow.querySelector('.content'),p=ui.shadow.querySelector('.panel').getBoundingClientRect();return {overflow:c.scrollWidth>c.clientWidth+1,outside:p.left<0||p.top<0||p.right>innerWidth+1||p.bottom>innerHeight+1,controls:[...ui.shadow.querySelectorAll('.nsfw-modes [data-action="group"],.nsfw-options .switch')].map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height,overflow:n.scrollWidth>n.clientWidth+1}})};`);
        assert(!metrics.overflow && !metrics.outside && metrics.controls.length === 7 && metrics.controls.every(c => c.height >= 44 && c.width >= 44 && !c.overflow), JSON.stringify({ theme: themeName, width, height, metrics }));
        if (themeName === 'midnight' || width === 390) {
          const shot = await cdp('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(`.ui-review/nsfw-${themeName}-${width}.png`, Buffer.from(shot.data, 'base64'));
        }
      }
    }
    results.push('四套主题及 1280、390、320、844 横屏布局无溢出，点击区域至少 44px');
    await size(320, 640);
    await theme('midnight');
    await run(`ui.state.editorUnlocked=true;ui.render();ui.shadow.querySelector('.nsfw-modes').scrollIntoView({block:'start'});`);
    await click('[data-placement-id="' + modeIds[1] + '"] [data-action="entry-edit"]');
    await check('320px 下模式编辑入口可实际点击，编辑面板不溢出', `ui.state.promptEditor?.id===ui.IDS.nsfwMale&&ui.shadow.querySelector('.prompt-editor-body').scrollWidth<=ui.shadow.querySelector('.prompt-editor-body').clientWidth+1`);
    await run(`ui.closePromptEditor(true);ui.state.editorUnlocked=false;ui.render();`);
    await click(toggle(extraIds[0]));
    await check('320px 下附加开关可实际点击并保存', `stored.prompts.find(p=>p.id===ui.IDS.nsfwSfw).enabled`);
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('.ui-review/nsfw-mobile-options.png', Buffer.from(shot.data, 'base64'));
  } finally {
    await run('ui.closePromptEditor(true);');
    await theme(await run('return __nsfwOriginal.theme;'));
    await run(`window.failWrite=null;ui.closePromptEditor(true);data=__nsfwOriginal.data;stored=__nsfwOriginal.stored;vars=__nsfwOriginal.vars;ui.state.config=__nsfwOriginal.config;ui.rebuildModelRegistry();ui.state.activeTab=__nsfwOriginal.tab;ui.state.disclosures=new Set(__nsfwOriginal.disclosures);ui.state.editorUnlocked=__nsfwOriginal.unlocked;ui.reconcilePreset('adult tests restored');ui.render();await ui.settle();for(const key of ['__nsfwOriginal','__nsfwFixture','__nsfwLoaded','__nsfwContent','__nsfwSaved','__nsfwAdded','__nsfwRoundtrip'])delete window[key];`);
    await size(1280, 960);
  }
  fs.writeFileSync('.ui-review/nsfw-results.json', JSON.stringify(results, null, 2));
  return results;
};
