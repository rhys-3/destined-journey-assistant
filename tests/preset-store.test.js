import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/preset/store.js';
import { createConnections } from '../src/preset/connections.js';

test('a failed script write leaves the next queued edit intact', async t => {
  const before = { managed_values: { min_hanzi: '1500', body_language: '简体中文' } };
  let stored = structuredClone(before);
  const writes = [];
  const globals = {
    getVariables: () => structuredClone(stored),
    replaceVariables: value => {
      writes.push(structuredClone(value));
      if (writes.length === 1) throw new Error('script write failed');
      stored = structuredClone(value);
    },
  };
  const original = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, globals);
  t.after(() => Object.assign(globalThis, original));
  t.mock.method(console, 'error', () => {});
  const observedDrafts = [];
  const ctx = {
    state: { config: structuredClone(before) }, savedScriptConfig: structuredClone(before),
    debounceTimers: new Map(), SAVE_DELAY: 300, saveChain: Promise.resolve(),
    renderStatus() {}, rebuildModelRegistry() {},
    renderActiveContent() { observedDrafts.push(structuredClone(this.state.config)); },
  };
  const store = createStore(ctx);
  const first = store.enqueueScriptConfigSave('字数', null, null, config => { config.managed_values.min_hanzi = '1800'; });
  const second = store.enqueueScriptConfigSave('语言', 'language:body', null, config => { config.managed_values.body_language = 'English'; });
  assert.deepEqual(ctx.state.config.managed_values, { min_hanzi: '1800', body_language: 'English' });
  ctx.debounceTimers.get('config:language:body').flush();
  await assert.rejects(first, /script write failed/);
  await second;
  assert.deepEqual(writes, [
    { managed_values: { min_hanzi: '1800', body_language: '简体中文' } },
    { managed_values: { min_hanzi: '1500', body_language: 'English' } },
  ]);
  assert.deepEqual(stored, writes[1]);
  assert.deepEqual(ctx.state.config, stored);
  assert.deepEqual(observedDrafts, [stored]);
});

test('rapid entry toggles replay only their own key and recheck the last enabled entry on commit', async t => {
  const initial = { entry_points: { floating_orb: true, input_button: false, wand_menu: false } };
  let stored = structuredClone(initial);
  let failNext = true;
  const attempted = [], errors = [], rendered = [];
  let visibleOrb, visibleButton;
  const globals = {
    getVariables: () => structuredClone(stored),
    replaceVariables: value => {
      attempted.push(structuredClone(value.entry_points));
      if (failNext) { failNext = false; throw new Error('script write failed'); }
      stored = structuredClone(value);
    },
    updateScriptButtonsWith: update => { visibleButton = update([])[0].visible; },
    window: { parent: { document: { getElementById: () => null } } },
    toastr: { error: message => errors.push(message) },
  };
  const original = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, globals);
  t.after(() => Object.assign(globalThis, original));
  t.mock.method(console, 'error', () => {});
  const ctx = {
    state: { config: structuredClone(initial) }, savedScriptConfig: structuredClone(initial),
    saveChain: Promise.resolve(), LEGACY_BUTTON_NAMES: [], BUTTON_NAME: 'assistant',
    syncOrbVisibility() { visibleOrb = this.state.config.entry_points.floating_orb; },
    renderStatus() {}, rebuildModelRegistry() {},
    renderActiveContent() { rendered.push(structuredClone(this.state.config.entry_points)); },
  };
  Object.assign(ctx, createStore(ctx), createConnections(ctx));
  await Promise.all([ctx.updateEntryPoint('input_button', true), ctx.updateEntryPoint('floating_orb', false)]);
  assert.deepEqual(attempted, [{ ...initial.entry_points, input_button: true }]);
  assert.deepEqual(stored, initial);
  assert.deepEqual(ctx.state.config, initial);
  assert.deepEqual(rendered, [initial.entry_points, initial.entry_points]);
  assert.deepEqual(errors, ['script write failed', '至少需要保留一个设置界面入口。']);
  assert.equal(visibleOrb, true);
  assert.equal(visibleButton, false);

  failNext = true;
  await Promise.all([ctx.updateEntryPoint('input_button', true), ctx.updateEntryPoint('wand_menu', true)]);
  assert.deepEqual(stored.entry_points, { ...initial.entry_points, wand_menu: true });
  assert.deepEqual(ctx.state.config, stored);
  assert.equal(visibleButton, false);
});
