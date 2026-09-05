import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnections } from '../src/preset/connections.js';
import { BUTTON_NAME, LEGACY_BUTTON_NAMES } from '../src/preset/definitions.js';

test('renaming the assistant consolidates legacy buttons without losing unrelated buttons', () => {
  const previous = globalThis.updateScriptButtonsWith;
  let buttons = [
    { name: '命定预设设置', visible: false, custom: 'preserve' },
    { name: '命定设置', visible: true },
    { name: '另一个脚本按钮', visible: true },
  ];
  globalThis.updateScriptButtonsWith = update => { buttons = update(buttons); };
  try {
    const state = { config: { entry_points: { input_button: true } } };
    const api = createConnections({ state, BUTTON_NAME, LEGACY_BUTTON_NAMES });
    api.syncInputButtonEntry();
    assert.deepEqual(buttons, [
      { name: '另一个脚本按钮', visible: true },
      { name: '命定预设助手', visible: true, custom: 'preserve' },
    ]);
    api.syncInputButtonEntry();
    assert.equal(buttons.length, 2);
    state.config.entry_points.input_button = false;
    api.syncInputButtonEntry();
    assert.equal(buttons.find(button => button.name === BUTTON_NAME).visible, false);
  } finally {
    if (previous === undefined) delete globalThis.updateScriptButtonsWith;
    else globalThis.updateScriptButtonsWith = previous;
  }
});
