import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeDiscussionMode } from '../src/discussion/native-mode.js';

function setup() {
  let chats = { a: {}, b: {} }, preset = { prompts: [{ id: 'destined-discussion-toggle', enabled: false }], prompts_unused: [] }, context = 'a', busy = false, available = true;
  const notices = [];
  globalThis.getPreset = () => structuredClone(preset);
  globalThis.substitudeMacros = text => {
    const set = text.match(/^{{setvar::本轮场外讨论::([01])}}$/); if (set) { setup.round = set[1]; return ''; }
    if (text === '{{getvar::本轮场外讨论}}') return setup.round ?? '';
    return text;
  };
  const native = createNativeDiscussionMode({ host: globalThis, contextKey: () => context, readChatMode: () => chats[context].destined_discussion_mode,
    writeChatMode: async value => { chats[context].destined_discussion_mode = value; }, busy: () => busy, changed: () => {},
    availability: () => ({ available, reason: 'Use Gemini or a copied discussion template.' }), onUnsupported: value => notices.push(value),
    ctx: { queuePresetMutation: async (_label, mutate) => { const next = structuredClone(preset); mutate(next); preset = next; } } });
  return { native, notices, chat: () => chats[context], preset: () => preset, setNative: value => { preset.prompts[0].enabled = value; }, busy: value => { busy = value; }, context: value => { context = value; }, available: value => { available = value; } };
}

test('first chat uses story, then mirrors direct native changes into that chat only', async () => {
  const state = setup(); await state.native.synchronize(); assert.equal(state.preset().prompts[0].enabled, false);
  state.setNative(true); await state.native.synchronize(); assert.equal(state.chat().destined_discussion_mode, true);
  state.context('b'); await state.native.synchronize(); assert.equal(state.preset().prompts[0].enabled, false);
});

test('round macro writes and validates the native macro scope', () => {
  const state = setup(); state.native.prepareRound('discussion'); assert.equal(setup.round, '1');
  state.native.prepareRound('story'); assert.equal(setup.round, '0');
});

test('a native click during generation cannot change the frozen chat state', async () => {
  const state = setup(); await state.native.synchronize(); state.busy(true); state.setNative(true); await state.native.synchronize();
  assert.equal(state.chat().destined_discussion_mode, undefined);
});

test('changing to an unsupported adapter turns off the real native toggle once without altering chat content', async () => {
  const state = setup();
  await state.native.synchronize();
  state.setNative(true); await state.native.synchronize();
  state.available(false);
  await Promise.all([state.native.synchronize(), state.native.synchronize(), state.native.synchronize()]);
  assert.equal(state.chat().destined_discussion_mode, false);
  assert.equal(state.preset().prompts[0].enabled, false);
  assert.equal(state.notices.length, 1);
  state.native.prepareRound('story'); assert.equal(setup.round, '0');
  assert.throws(() => state.native.prepareRound('discussion'), /Use Gemini/);
  state.available(true); await state.native.synchronize();
  assert.equal(state.chat().destined_discussion_mode, false, 'returning to Gemini does not silently reactivate discussion');
});

test('an unsupported adapter does not change an active reply mode; after completion it clears the chat switch', async () => {
  const state = setup(); await state.native.synchronize();
  state.setNative(true); await state.native.synchronize();
  state.busy(true); state.available(false); await state.native.synchronize();
  assert.equal(state.chat().destined_discussion_mode, true);
  assert.equal(state.preset().prompts[0].enabled, true);
  assert.equal(state.notices.length, 0);
  state.busy(false); await state.native.synchronize();
  assert.equal(state.chat().destined_discussion_mode, false);
  assert.equal(state.preset().prompts[0].enabled, false);
});
