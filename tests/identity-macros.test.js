import test from 'node:test';
import assert from 'node:assert/strict';
import * as definitions from '../src/preset/definitions.js';
import { createStore } from '../src/preset/store.js';
import { createManaged } from '../src/preset/managed.js';
import { compilePrompt, snapshotContext } from '../src/summary/macros.js';
import { messagesToMergedText } from '../src/summary/messages.js';

const marker = '<|命定_正文开始|>';

function installIdentityHost(t, names = { user: 'Alice $&', char: 'Bard $&', group: 'Party $&', charIfNotGroup: 'Bard $&' }) {
  const previous = { SillyTavern: globalThis.SillyTavern, registerMacroLike: globalThis.registerMacroLike, toastr: globalThis.toastr };
  const host = {
    name1: names.user,
    name2: names.char,
    getContext: () => ({ chatId: 'identity-test', characterId: 1 }),
    substituteParams: token => ({ '{{group}}': names.group, '{{charIfNotGroup}}': names.charIfNotGroup }[token] ?? token),
  };
  globalThis.SillyTavern = host;
  globalThis.toastr = { error() {} };
  t.after(() => Object.assign(globalThis, previous));
  return { host, names };
}

function managedHarness(t, names) {
  const { host } = installIdentityHost(t, names);
  const registrations = [];
  globalThis.registerMacroLike = (pattern, callback) => { registrations.push({ pattern, callback }); return { stop() {} }; };
  const globalSettings = [{ id: 'global-1', enabled: true, text: 'Keep <user> with {{char}} / <group> / <charIfNotGroup>' }];
  const additionalSettings = [{ id: 'additional-1', enabled: true, text: 'Tail for <bot> and {{user}}' }];
  const savedValues = { ...definitions.DEFAULT_MANAGED_VALUES, global_settings: structuredClone(globalSettings), user_additional_settings: structuredClone(additionalSettings) };
  const ctx = {
    ...definitions,
    state: { preset: { prompts: [{ id: definitions.IDS.outputLength, content: '<|字数|>' }] }, config: { managed_values: savedValues } },
    macroStops: [],
    getPrompt: (preset, id) => preset.prompts.find(prompt => prompt.id === id),
    enqueueScriptConfigSave: () => Promise.resolve(),
  };
  ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
  return { managed: createManaged(ctx), registrations, host, savedValues, globalSettings, additionalSettings };
}

test('managed registration and both request passes resolve identity aliases only in marked Prime requests', t => {
  const fixture = managedHarness(t);
  fixture.managed.registerManagedMacros();
  assert.equal(fixture.registrations.length, 1);
  const globalSettings = fixture.registrations[0].callback(null, '<|全局设定|>', '全局设定');
  assert.equal(globalSettings, '- Keep Alice $& with Bard $& / Party $& / Bard $&');
  assert.deepEqual(fixture.savedValues.global_settings, fixture.globalSettings, 'macro registration must not rewrite saved setting templates');
  assert.deepEqual(fixture.savedValues.user_additional_settings, fixture.additionalSettings, 'macro registration must not rewrite saved user templates');

  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } };
  const customStyle = '<main_writing_style>Write <user> with {{char}}.</main_writing_style>';
  const copiedModelTail = '<model_tail><bot> observes <group>; {{charIfNotGroup}} replies.</model_tail>';
  const messages = [
    { role: 'system', content: `${marker}\n${customStyle}\n<|全局设定|>` },
    { role: 'assistant', content: copiedModelTail },
    { role: 'user', content: [{ type: 'text', text: '<|命定_正文结束|> Participant <user> / {{char}}' }, image] },
  ];
  const savedPromptTemplates = structuredClone({ customStyle, copiedModelTail });
  fixture.managed.expandOutgoingMessages(messages);
  const firstPass = structuredClone(messages);
  fixture.managed.expandOutgoingMessages(messages);
  assert.deepEqual(messages, firstPass, 'both registered request stages must be idempotent');
  assert.match(messages[0].content, /Write Alice \$& with Bard \$&/);
  assert.match(messages[0].content, /Keep Alice \$& with Bard \$& \/ Party \$& \/ Bard \$&/);
  assert.equal(messages[1].content, '<model_tail>Bard $& observes Party $&; Bard $& replies.</model_tail>');
  assert.equal(messages[2].content[0].text, '<|命定_正文结束|> Participant Alice $& / Bard $&');
  assert.deepEqual(messages[2].content[1], image, 'multimodal parts must remain intact');
  assert.deepEqual({ customStyle, copiedModelTail }, savedPromptTemplates, 'custom style and copied model-tail templates stay reusable');

  fixture.host.name1 = 'Next $& User'; fixture.host.name2 = 'Next $& Char';
  const next = [{ role: 'system', content: `${marker} <user> <char> <bot> <|命定_正文结束|>` }];
  fixture.managed.expandOutgoingMessages(next);
  assert.equal(next[0].content, `${marker} Next $& User Next $& Char Next $& Char <|命定_正文结束|>`, 'names are captured for each request');

  const summary = [{ role: 'user', content: '<source_material>literal <user> {{user}}</source_material>\n<|命定_正文开始|>' }];
  fixture.managed.expandOutgoingMessages(summary);
  assert.equal(summary[0].content, '<source_material>literal <user> {{user}}</source_material>\n<|命定_正文开始|>', 'a one-sided Prime marker must not rewrite a summary request');
});

test('summary prompt aliases recurse through custom macros but keep history and source material opaque', async t => {
  const { host } = installIdentityHost(t);
  host.getCharacterCardFields = () => ({ persona: 'Persona <user> {{char}}', description: 'Description <bot>', personality: '', scenario: '', mesExamples: '' });
  const snapshot = await snapshotContext({ kind: 'normal', mergedChatText: 'MATERIAL <user> {{user}}', oldSummaryContent: 'HISTORY <char> {{char}}' }, {});
  assert.equal(snapshot['summary.persona'], 'Persona Alice $& Bard $&');
  assert.equal(snapshot['summary.character'], 'Description Bard $&');
  assert.equal(snapshot['summary.material'], 'MATERIAL <user> {{user}}');
  assert.equal(snapshot['summary.history'], 'HISTORY <char> {{char}}');

  const compiled = await compilePrompt({
    promptBlocks: [
      { id: 'rule', type: 'prompt', enabled: true, role: 'system', content: 'Rule <user> {{char}} <group> <charIfNotGroup> {{custom}}' },
      { id: 'history', type: 'old_summary', enabled: true, role: 'system' },
      { id: 'material', type: 'chat_messages', enabled: true, role: 'user', leadText: 'Source <bot>', xmlTag: 'source_material' },
    ],
    macroValues: snapshot,
  }, { customMacros: [{ name: 'custom', content: 'Custom <user> then {{nested}}' }, { name: 'nested', content: '<char>' }] });
  const all = compiled.orderedPrompts.map(message => message.content).join('\n');
  assert.match(all, /Rule Alice \$& Bard \$& Party \$& Bard \$& Custom Alice \$& then Bard \$&/);
  assert.match(all, /<prior_memory>\nHISTORY <char> \{\{char\}\}\n<\/prior_memory>/);
  assert.match(all, /<source_material>\nMATERIAL <user> \{\{user\}\}\n<\/source_material>/);

  assert.equal(messagesToMergedText([{ id: 0, role: 'user', content: 'attempt' }, { id: 1, role: 'assistant', content: 'result' }], '<user> {{char}}', '<bot> <char>'), '[第 0 楼 · 用户输入（意图，未必实现） · Alice $& Bard $&]\nattempt\n\n[第 1 楼 · AI 正文（实际剧情） · Bard $& Bard $&]\nresult');
});
