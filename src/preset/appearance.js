// Dependencies use live accessors so asynchronous operations share the current state.
export function createAppearance(ctx) {
  function loadUiState() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ctx.STORAGE_KEY) ?? '{}');
      return { ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}), ...ctx.volatileUiState };
    } catch {
      return { ...ctx.volatileUiState };
    }
  }

  function saveUiState(value) {
    ctx.volatileUiState = value;
    try {
      window.localStorage.setItem(ctx.STORAGE_KEY, JSON.stringify(value));
      ctx.volatileUiState = {};
      return true;
    } catch {
      // Private mode / full storage must not prevent opening or moving settings.
      return false;
    }
  }

  function renderThemeControl() {
    return '<div class="appearance-controls"><label class="theme-control" title="界面主题，仅保存在当前浏览器"><span>主题</span><select data-action="ui-theme" aria-label="界面主题">'
      + ctx.UI_THEMES.map(theme => '<option value="' + theme.id + '"' + (ctx.currentTheme === theme.id ? ' selected' : '') + '>' + theme.label + '</option>').join('')
      + '</select></label><label class="transparency-control" title="0% 不透明，数值越大越通透；仅保存在当前浏览器"><span>透明度</span><input type="range" min="0" max="10" step="1" value="' + ctx.currentTransparency + '" data-action="ui-transparency" aria-label="界面透明度" aria-valuetext="' + ctx.currentTransparency + '%"><output data-transparency-value>' + ctx.currentTransparency + '%</output></label></div>';
  }

  function normalizeTransparency(value) {
    // Accept the previous 0–30 range when loading, then cap it at the new maximum.
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 30 ? Math.min(10, Math.round(value)) : 1;
  }

  function applyTransparency(value = ctx.currentTransparency, persist = false) {
    ctx.currentTransparency = normalizeTransparency(value);
    ctx.app?.style.setProperty('--panel-opacity', String(1 - ctx.currentTransparency / 100));
    const slider = ctx.shadow?.querySelector('[data-action="ui-transparency"]');
    if (slider) { if (Number(slider.value) !== ctx.currentTransparency) slider.value = ctx.currentTransparency; slider.setAttribute('aria-valuetext', ctx.currentTransparency + '%'); }
    const output = ctx.shadow?.querySelector('[data-transparency-value]');
    if (output) output.textContent = ctx.currentTransparency + '%';
    if (persist) {
      const saved = saveUiState({ ...loadUiState(), transparency: ctx.currentTransparency });
      const feedback = ctx.shadow?.querySelector('.theme-feedback');
      if (feedback) {
        feedback.textContent = '透明度已设为' + ctx.currentTransparency + '%' + (saved ? '' : '；浏览器存储不可用，本次会话有效。');
        feedback.classList.toggle('sr-only', saved);
      }
    }
  }

  function applyTheme(value = ctx.currentTheme, persist = false) {
    const theme = ctx.UI_THEMES.find(item => item.id === value) ?? ctx.UI_THEMES[0];
    ctx.currentTheme = theme.id;
    if (ctx.app) ctx.app.dataset.theme = ctx.currentTheme;
    applyTransparency();
    const select = ctx.shadow?.querySelector('[data-action="ui-theme"]');
    if (select) select.value = ctx.currentTheme;
    if (persist) {
      const saved = saveUiState({ ...loadUiState(), theme: ctx.currentTheme });
      const feedback = ctx.shadow?.querySelector('.theme-feedback');
      if (feedback) {
        feedback.textContent = saved ? '已切换为' + theme.label : '已切换为' + theme.label + '；浏览器存储不可用，本次会话有效。';
        feedback.classList.toggle('sr-only', saved);
      }
    }
  }

  function isMobileViewport() {
    const parentWindow = window.parent;
    const width = parentWindow.innerWidth;
    const height = parentWindow.innerHeight;
    const coarsePointer = parentWindow.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches === true;
    const touchCapable = coarsePointer || Number(parentWindow.navigator?.maxTouchPoints ?? 0) > 0;
    const screenWidth = Number(parentWindow.screen?.width ?? width);
    const screenHeight = Number(parentWindow.screen?.height ?? height);
    const phoneSizedScreen = Math.min(screenWidth, screenHeight) <= ctx.MOBILE_BREAKPOINT;
    return width <= ctx.MOBILE_BREAKPOINT || (touchCapable && phoneSizedScreen);
  }

  function clampNumber(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function getViewportInsets() {
    const parentWindow = window.parent;
    const parentDocument = parentWindow.document;
    const rootStyle = parentWindow.getComputedStyle(parentDocument.documentElement);
    const bodyStyle = parentDocument.body ? parentWindow.getComputedStyle(parentDocument.body) : null;
    const readInset = name => {
      const value = Number.parseFloat(bodyStyle?.getPropertyValue(name) || rootStyle.getPropertyValue(name));
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    return {
      top: readInset('--tt-inset-top'),
      right: readInset('--tt-inset-right'),
      bottom: readInset('--tt-inset-bottom'),
      left: readInset('--tt-inset-left'),
    };
  }

  function getMobilePanelGeometry() {
    const parentWindow = window.parent;
    const viewport = parentWindow.visualViewport;
    const viewportWidth = viewport?.width || parentWindow.innerWidth;
    const viewportHeight = viewport?.height || parentWindow.innerHeight;
    const offsetLeft = viewport?.offsetLeft || 0;
    const offsetTop = viewport?.offsetTop || 0;
    const insets = getViewportInsets();
    const margin = 8;
    const x = offsetLeft + insets.left + margin;
    const y = offsetTop + insets.top + margin;
    const width = Math.max(1, viewportWidth - insets.left - insets.right - margin * 2);
    const height = Math.max(1, viewportHeight - insets.top - insets.bottom - margin * 2);
    return { x, y, width, height };
  }

  function clampPanelGeometry(raw = {}) {
    const viewportWidth = window.parent.innerWidth;
    const viewportHeight = window.parent.innerHeight;
    const maxWidth = Math.max(1, viewportWidth - ctx.PANEL_VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(1, viewportHeight - ctx.PANEL_VIEWPORT_MARGIN * 2);
    const minWidth = Math.min(ctx.PANEL_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(ctx.PANEL_MIN_HEIGHT, maxHeight);
    const fallbackWidth = Math.min(1080, maxWidth);
    const fallbackHeight = Math.min(780, maxHeight);
    const requestedWidth = Number(raw.width);
    const requestedHeight = Number(raw.height);
    const width = clampNumber(Number.isFinite(requestedWidth) ? requestedWidth : fallbackWidth, minWidth, maxWidth);
    const height = clampNumber(Number.isFinite(requestedHeight) ? requestedHeight : fallbackHeight, minHeight, maxHeight);
    const fallbackX = Math.round((viewportWidth - width) / 2);
    const fallbackY = Math.round((viewportHeight - height) / 2);
    const requestedX = Number(raw.x);
    const requestedY = Number(raw.y);
    const x = clampNumber(
      Number.isFinite(requestedX) ? requestedX : fallbackX,
      ctx.PANEL_VIEWPORT_MARGIN,
      Math.max(ctx.PANEL_VIEWPORT_MARGIN, viewportWidth - width - ctx.PANEL_VIEWPORT_MARGIN),
    );
    const y = clampNumber(
      Number.isFinite(requestedY) ? requestedY : fallbackY,
      ctx.PANEL_VIEWPORT_MARGIN,
      Math.max(ctx.PANEL_VIEWPORT_MARGIN, viewportHeight - height - ctx.PANEL_VIEWPORT_MARGIN),
    );
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  function savePanelGeometry(geometry) {
    const current = loadUiState();
    current.panel = clampPanelGeometry(geometry);
    saveUiState(current);
  }

  function applyPanelGeometry() {
    ctx.app?.classList.toggle('mobile-layout', isMobileViewport());
    const panel = ctx.shadow?.querySelector('.panel');
    if (!panel) return;
    if (isMobileViewport()) {
      const geometry = getMobilePanelGeometry();
      panel.style.setProperty('left', `${Math.round(geometry.x)}px`, 'important');
      panel.style.setProperty('top', `${Math.round(geometry.y)}px`, 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
      panel.style.setProperty('width', `${Math.round(geometry.width)}px`, 'important');
      panel.style.setProperty('height', `${Math.round(geometry.height)}px`, 'important');
      return;
    }
    panel.style.removeProperty('right');
    panel.style.removeProperty('bottom');
    const geometry = clampPanelGeometry(loadUiState().panel);
    panel.style.left = `${geometry.x}px`;
    panel.style.top = `${geometry.y}px`;
    panel.style.width = `${geometry.width}px`;
    panel.style.height = `${geometry.height}px`;
  }

  function handleViewportResize() {
    ctx.cancelPromptSort();
    ctx.app?.classList.toggle('mobile-layout', isMobileViewport());
    clampOrbToViewport();
    applyPanelGeometry();
  }

  function saveOrbPosition(x, y) {
    const current = loadUiState();
    current.orb = { x: Math.round(x), y: Math.round(y) };
    saveUiState(current);
  }

  function getNumericMode(key, currentValue) {
    const mode = loadUiState().numericModes?.[key];
    if (mode === 'custom' || mode === 'preset') return mode;
    return ctx.FIELD_DEFINITIONS[key].presets.map(String).includes(String(currentValue)) ? 'preset' : 'custom';
  }

  function setNumericMode(key, mode) {
    const current = loadUiState();
    current.numericModes = current.numericModes && typeof current.numericModes === 'object'
      ? current.numericModes
      : {};
    current.numericModes[key] = mode;
    saveUiState(current);
  }

  function clampOrbToViewport() {
    const orb = ctx.shadow?.querySelector('.orb');
    if (!orb) return;
    const rect = orb.getBoundingClientRect();
    const x = Math.min(Math.max(8, rect.left), window.parent.innerWidth - rect.width - 8);
    const y = Math.min(Math.max(8, rect.top), window.parent.innerHeight - rect.height - 8);
    orb.style.left = `${x}px`;
    orb.style.top = `${y}px`;
    orb.style.right = 'auto';
    orb.style.bottom = 'auto';
    saveOrbPosition(x, y);
  }

  function dismissExtensionsMenu() {
    const parentWindow = window.parent;
    const parentDocument = parentWindow.document;
    const menu = parentDocument.getElementById('extensionsMenu');
    if (!menu) return;
    const style = parentWindow.getComputedStyle(menu);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && menu.getClientRects().length > 0;
    if (!visible) return;
    parentDocument.getElementById('extensionsMenuButton')?.click();
  }

  function openPanel() {
    dismissExtensionsMenu();
    ctx.state.open = true;
    ctx.refreshPreset(false);
    ctx.scheduleWorldbookScan();
    // 先显示面板，再执行元数据和连接配置同步；移动网络或慢设备不应阻塞入口响应。
    ctx.render();
    if (!isMobileViewport()) queueMicrotask(() => ctx.shadow.querySelector('[data-action="close"]')?.focus());
    Promise.allSettled([ctx.loadProfiles(false), ctx.ensurePromptMetadata()]).finally(() => {
      if (!ctx.state.open) return;
      ctx.render();
    });
  }

  function closePanel() {
    ctx.cancelPromptSort();
    ctx.state.reorderUndo = null;
    ctx.state.styleEditor = null;
    ctx.state.promptEditor = null;
    ctx.state.editorUnlocked = false;
    ctx.state.open = false;
    ctx.render();
    queueMicrotask(() => ctx.shadow.querySelector('.orb')?.focus());
  }

  function handleOrbPointerDown(event) {
    const orb = event.target.closest('.orb');
    if (!orb || event.button !== 0) return;
    event.preventDefault();
    const parentWindow = window.parent;
    const startRect = orb.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const pointerId = event.pointerId;
    try { orb.setPointerCapture?.(pointerId); } catch { /* 部分移动端不支持跨 Shadow DOM 捕获 */ }

    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.hypot(dx, dy) > 7) moved = true;
      const x = Math.min(Math.max(8, startRect.left + dx), parentWindow.innerWidth - startRect.width - 8);
      const y = Math.min(Math.max(8, startRect.top + dy), parentWindow.innerHeight - startRect.height - 8);
      orb.style.left = `${x}px`;
      orb.style.top = `${y}px`;
      orb.style.right = 'auto';
      orb.style.bottom = 'auto';
    };
    const finish = (upEvent, cancelled = false) => {
      if (upEvent?.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
      window.parent.document.removeEventListener('pointermove', onMove);
      window.parent.document.removeEventListener('pointerup', onUp);
      window.parent.document.removeEventListener('pointercancel', onCancel);
      try { orb.releasePointerCapture?.(pointerId); } catch { /* ignore */ }
      const rect = orb.getBoundingClientRect();
      const x = Math.min(Math.max(8, rect.left), parentWindow.innerWidth - rect.width - 8);
      const y = Math.min(Math.max(8, rect.top), parentWindow.innerHeight - rect.height - 8);
      orb.style.left = `${x}px`;
      orb.style.top = `${y}px`;
      saveOrbPosition(x, y);
      // 某些移动端在 pointerdown 被阻止后不会派发 click；轻触在这里直接打开。
      if (!moved && !cancelled) {
        ctx.suppressOrbClick = true;
        openPanel();
        window.setTimeout(() => { ctx.suppressOrbClick = false; }, 0);
      } else {
        ctx.suppressOrbClick = moved;
      }
    };
    const onUp = upEvent => finish(upEvent, false);
    const onCancel = cancelEvent => finish(cancelEvent, true);
    window.parent.document.addEventListener('pointermove', onMove);
    window.parent.document.addEventListener('pointerup', onUp);
    window.parent.document.addEventListener('pointercancel', onCancel);
  }

  function handlePanelPointerDown(event) {
    if (isMobileViewport() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const resizeHandle = event.target.closest('[data-panel-resize-handle]');
    const dragHandle = event.target.closest('[data-panel-drag-handle]');
    if (!resizeHandle && !dragHandle) return;
    if (dragHandle && event.target.closest('button, input, label, textarea, select, summary, a')) return;

    const panel = event.target.closest('.panel');
    if (!panel) return;
    event.preventDefault();
    const parentDocument = window.parent.document;
    const startRect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    panel.classList.add(resizeHandle ? 'panel-resizing' : 'panel-moving');

    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (resizeHandle) {
        const maximumWidth = Math.max(1, window.parent.innerWidth - startRect.left - ctx.PANEL_VIEWPORT_MARGIN);
        const maximumHeight = Math.max(1, window.parent.innerHeight - startRect.top - ctx.PANEL_VIEWPORT_MARGIN);
        const minimumWidth = Math.min(ctx.PANEL_MIN_WIDTH, maximumWidth);
        const minimumHeight = Math.min(ctx.PANEL_MIN_HEIGHT, maximumHeight);
        panel.style.width = `${Math.round(clampNumber(startRect.width + dx, minimumWidth, maximumWidth))}px`;
        panel.style.height = `${Math.round(clampNumber(startRect.height + dy, minimumHeight, maximumHeight))}px`;
        return;
      }
      const maximumX = Math.max(ctx.PANEL_VIEWPORT_MARGIN, window.parent.innerWidth - startRect.width - ctx.PANEL_VIEWPORT_MARGIN);
      const maximumY = Math.max(ctx.PANEL_VIEWPORT_MARGIN, window.parent.innerHeight - startRect.height - ctx.PANEL_VIEWPORT_MARGIN);
      panel.style.left = `${Math.round(clampNumber(startRect.left + dx, ctx.PANEL_VIEWPORT_MARGIN, maximumX))}px`;
      panel.style.top = `${Math.round(clampNumber(startRect.top + dy, ctx.PANEL_VIEWPORT_MARGIN, maximumY))}px`;
    };

    const onUp = () => {
      parentDocument.removeEventListener('pointermove', onMove);
      parentDocument.removeEventListener('pointerup', onUp);
      parentDocument.removeEventListener('pointercancel', onUp);
      panel.classList.remove('panel-moving', 'panel-resizing');
      const rect = panel.getBoundingClientRect();
      savePanelGeometry({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    parentDocument.addEventListener('pointermove', onMove);
    parentDocument.addEventListener('pointerup', onUp);
    parentDocument.addEventListener('pointercancel', onUp);
  }

  return {
    loadUiState,
    saveUiState,
    renderThemeControl,
    normalizeTransparency,
    applyTransparency,
    applyTheme,
    isMobileViewport,
    clampNumber,
    getViewportInsets,
    getMobilePanelGeometry,
    clampPanelGeometry,
    savePanelGeometry,
    applyPanelGeometry,
    handleViewportResize,
    saveOrbPosition,
    getNumericMode,
    setNumericMode,
    clampOrbToViewport,
    dismissExtensionsMenu,
    openPanel,
    closePanel,
    handleOrbPointerDown,
    handlePanelPointerDown
  };
}
