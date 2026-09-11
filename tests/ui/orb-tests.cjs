module.exports = async (cdp, evaluate) => {
  const results = [];
  const check = (name, ok) => {
    if (!ok) throw Error(name);
    results.push(name);
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const mobile = async () => {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('ui.closePanel();ui.render();');
  };
  const desktop = async () => {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, screenWidth: 1280, screenHeight: 960, deviceScaleFactor: 1, mobile: false });
    await evaluate('ui.closePanel();ui.render();');
  };
  const orbPoint = () => evaluate(`(()=>{const r=ui.shadow.querySelector('.orb').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const touch = (type, x, y) => cdp('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 3, radiusY: 3 }],
  });
  const overlap = () => evaluate(`(()=>{
    ui.openPanel();
    const close=ui.shadow.querySelector('[data-action="close"]').getBoundingClientRect();
    ui.closePanel();
    const orb=ui.shadow.querySelector('.orb');
    orb.style.left=(close.left+close.width/2-orb.getBoundingClientRect().width/2)+'px';
    orb.style.top=(close.top+close.height/2-orb.getBoundingClientRect().height/2)+'px';
    return {x:close.left+close.width/2,y:close.top+close.height/2};
  })()`);
  const simulatedTap = point => evaluate(`(()=>{
    const orb=ui.shadow.querySelector('.orb');
    orb.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,button:0,pointerId:71,pointerType:'touch',clientX:${point.x},clientY:${point.y}}));
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true,button:0,pointerId:71,pointerType:'touch',clientX:${point.x},clientY:${point.y}}));
  })()`);
  const delayedCloseClick = detail => evaluate(`(()=>{
    const close=ui.shadow.querySelector('[data-action="close"]');
    close.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true,detail:${detail},clientX:close.getBoundingClientRect().left+20,clientY:close.getBoundingClientRect().top+20}));
  })()`);

  await mobile();
  let point = await overlap();
  await simulatedTap(point);
  await pause(300);
  // 模拟 PointerEvent 不会由浏览器自动补发 click；这里显式复现移动端 300ms 后命中新关闭按钮的时序。
  await delayedCloseClick(1);
  check('模拟 PointerEvent 的300毫秒尾随点击不会关闭刚打开的手机面板', await evaluate('ui.state.open'));

  await mobile();
  point = await overlap();
  await simulatedTap(point);
  await evaluate(`(()=>{const close=ui.shadow.querySelector('[data-action="close"]');close.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,button:0,pointerId:72,pointerType:'touch',clientX:${point.x},clientY:${point.y}}));})()`);
  await delayedCloseClick(1);
  check('新的pointerdown会解除保护，主动关闭不会被吞掉', await evaluate('!ui.state.open'));

  await mobile();
  point = await overlap();
  await simulatedTap(point);
  await delayedCloseClick(0);
  check('detail为0的键盘或程序关闭点击仍可用', await evaluate('!ui.state.open'));

  await mobile();
  point = await orbPoint();
  await touch('touchStart', point.x, point.y);
  await touch('touchEnd');
  await pause(120);
  check('实际CDP触屏轻触可打开悬浮球', await evaluate('ui.state.open'));

  await mobile();
  point = await orbPoint();
  await touch('touchStart', point.x, point.y);
  await touch('touchMove', point.x, point.y + 24);
  await touch('touchEnd');
  await pause(80);
  check('实际CDP触屏拖动悬浮球不会打开面板', await evaluate('!ui.state.open'));

  await mobile();
  point = await orbPoint();
  await touch('touchStart', point.x, point.y);
  await touch('touchCancel');
  await pause(80);
  check('实际CDP触屏取消不会打开面板', await evaluate('!ui.state.open'));

  await desktop();
  point = await orbPoint();
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  await pause(80);
  check('桌面鼠标点击仍可打开悬浮球', await evaluate('ui.state.open'));
  return results;
};
