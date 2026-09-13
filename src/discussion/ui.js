const ACTIVE_STYLE = 'background:#65468b;color:#fff;border-color:#ac8cce;';
const DISABLED_STYLE = 'opacity:.52;cursor:not-allowed;';
const MENU_STYLE = 'display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;';
const PANEL_BUTTON_STYLE = 'display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--muted,currentColor);';

function discussionIcon(doc) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '17');
  svg.setAttribute('height', '17');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const bubble = doc.createElementNS(svg.namespaceURI, 'path');
  bubble.setAttribute('d', 'M20 11.4a7.6 7.6 0 0 1-8 7.1 8.6 8.6 0 0 1-3.4-.7L4 19l1.2-3.4A6.8 6.8 0 0 1 4 11.4a7.6 7.6 0 0 1 8-7.1 7.6 7.6 0 0 1 8 7.1Z');
  const dots = doc.createElementNS(svg.namespaceURI, 'path');
  dots.setAttribute('d', 'M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01');
  svg.append(bubble, dots);
  return svg;
}

/** Compact discussion controls for the native composer and the assistant panel. */
export function createDiscussionUi({ doc, ctx, onToggle }) {
  let disposed = false;
  let menuContainer = null;
  let menuItem = null;
  let status = null;
  let panelToggle = null;

  const toggleLabel = '切换讨论模式';
  const click = callback => event => {
    event.preventDefault();
    event.stopPropagation();
    callback?.();
  };
  const button = (label, callback, className = '') => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.addEventListener('click', click(callback));
    return element;
  };
  const dismissExtensionsMenu = () => {
    const menu = doc.querySelector('#extensionsMenu');
    if (!menu) return;
    const style = doc.defaultView?.getComputedStyle?.(menu);
    const visible = style?.display !== 'none' && style?.visibility !== 'hidden' && menu.getClientRects().length > 0;
    if (visible) doc.querySelector('#extensionsMenuButton')?.click();
  };
  const toggleFromMenu = () => {
    dismissExtensionsMenu();
    onToggle?.();
  };
  const ensureMenu = () => {
    const menu = doc.querySelector('#extensionsMenu');
    if (!menu) return;
    if (menuContainer?.isConnected && menuContainer.parentNode === menu) return;
    menuContainer?.remove();
    menuContainer = doc.createElement('div');
    menuContainer.id = 'destined-discussion-menu';
    menuContainer.className = 'extension_container';
    menuItem = button(toggleLabel, toggleFromMenu, 'list-group-item flex-container flexGap5 destined-discussion-button');
    menuItem.setAttribute('role', 'menuitem');
    menuItem.append(discussionIcon(doc));
    const label = doc.createElement('span');
    label.textContent = '讨论';
    menuItem.append(label);
    menuContainer.append(menuItem);
    menu.append(menuContainer);
    const menuButton = doc.querySelector('#extensionsMenuButton');
    if (menuButton) menuButton.style.display = 'flex';
  };
  const ensureStatus = () => {
    const composer = doc.querySelector('#nonQRFormItems');
    if (!composer || status?.isConnected) return;
    status?.remove();
    status = doc.createElement('div');
    status.className = 'destined-discussion-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = '讨论中';
    status.style.cssText = 'display:none;align-items:center;width:max-content;max-width:100%;margin:0 0 3px auto;padding:2px 7px;border-radius:999px;background:#65468b;color:#fff;font-size:11px;line-height:16px;white-space:nowrap;pointer-events:none;';
    composer.insertAdjacentElement('beforebegin', status);
  };
  const ensurePanelToggle = () => {
    const heading = ctx?.shadow?.querySelector?.('.panel-title-row');
    if (!heading) return;
    if (panelToggle?.isConnected && panelToggle.parentNode === heading) return;
    panelToggle?.remove();
    panelToggle = button(toggleLabel, onToggle, 'icon-button destined-discussion-button');
    panelToggle.append(discussionIcon(doc));
    heading.prepend(panelToggle);
  };
  const unavailableTitle = ({ busy, unavailableReason }) => busy ? '生成结束后可切换讨论模式' : unavailableReason || '需要支持讨论模式的配套预设与当前聊天';
  const updateMenuItem = (element, { active, busy, available, unavailableReason }) => {
    if (!element) return;
    const disabled = busy || !available;
    element.disabled = disabled;
    element.setAttribute('aria-pressed', String(active));
    element.setAttribute('aria-label', active ? '关闭讨论模式并返回剧情' : toggleLabel);
    element.title = disabled ? unavailableTitle({ busy, unavailableReason }) : (active ? '关闭讨论模式并返回剧情' : toggleLabel);
    element.style.cssText = MENU_STYLE + (active ? ACTIVE_STYLE : '') + (disabled ? DISABLED_STYLE : '');
  };
  const updatePanelToggle = ({ active, busy, available, unavailableReason }) => {
    if (!panelToggle) return;
    const disabled = busy || !available;
    panelToggle.disabled = disabled;
    panelToggle.setAttribute('aria-pressed', String(active));
    panelToggle.setAttribute('aria-label', active ? '关闭讨论模式并返回剧情' : toggleLabel);
    panelToggle.title = disabled ? unavailableTitle({ busy, unavailableReason }) : (active ? '切换回剧情模式' : toggleLabel);
    panelToggle.style.cssText = PANEL_BUTTON_STYLE + (active ? ACTIVE_STYLE : '') + (disabled ? DISABLED_STYLE : '');
  };

  return {
    refresh(state = {}) {
      if (disposed) return;
      const current = { available: false, active: false, busy: false, unavailableReason: '', ...state };
      ensureMenu(); ensureStatus(); ensurePanelToggle();
      updateMenuItem(menuItem, current);
      updatePanelToggle(current);
      if (status) status.style.display = current.active ? 'inline-flex' : 'none';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      menuContainer?.remove(); status?.remove(); panelToggle?.remove();
      menuContainer = menuItem = status = panelToggle = null;
    },
  };
}
