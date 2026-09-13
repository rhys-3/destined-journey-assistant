import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNativeDiscussionMigration, discussionPromptMode, readNativeDiscussionConfig, wrapDiscussionCondition,
  sanitizeDiscussionSettings,
} from '../src/discussion/preferences.js';

function defaults() {
  return { version: 2, entries: [
    { id: 'destined-discussion-head', name: '头部', enabled: true, role: 'system', position: { type: 'relative' }, content: '默认头部' },
    { id: 'rules', name: '规则', enabled: true, role: 'system', position: { type: 'relative' }, content: '默认规则' },
    { id: 'destined-discussion-reference', kind: 'reference', name: '资料', enabled: true, role: 'user', position: { type: 'relative' }, content: '' },
    { id: 'destined-discussion-history', kind: 'history', name: '历史', enabled: true, role: 'user', position: { type: 'relative' }, content: '' },
    { id: 'thinking', name: '思考', enabled: false, role: 'assistant', position: { type: 'in_chat', depth: 0, order: 10 }, content: '默认思考' },
    { id: 'analysis', name: '分析', enabled: false, role: 'assistant', position: { type: 'in_chat', depth: 0, order: 20 }, content: '默认分析' },
    { id: 'destined-discussion-tail', name: '尾部', enabled: true, role: 'system', position: { type: 'relative' }, content: '默认尾部' },
  ], history: '默认历史' };
}

test('v4 stores only history', () => {
  const safe = sanitizeDiscussionSettings({ version: 4, history: '返回剧情', entries: ['discard'] });
  assert.deepEqual(safe, { version: 4, history: '返回剧情' });
  assert.throws(() => sanitizeDiscussionSettings({ version: 4, history: 1 }), /历史说明/);
});

test('v5 history stays readable without being rewritten into native prompts', () => {
  const source = { version: 5, history: '返回剧情', prompts: ['discard'] };
  assert.deepEqual(sanitizeDiscussionSettings(source), { version: 5, history: '返回剧情' });
  assert.throws(() => sanitizeDiscussionSettings({ version: 5, history: false }), /历史说明/);
  const native = { prompts: [{ id: 'custom', content: '保留自定义内容' }], extensions: { destined_discussion: { version: 5, history: 'H' } } };
  assert.equal(readNativeDiscussionConfig(native).history, 'H');
  assert.deepEqual(native.prompts, [{ id: 'custom', content: '保留自定义内容' }]);
});

test('v6 stores only its version marker', () => {
  assert.deepEqual(sanitizeDiscussionSettings({ version: 6 }), { version: 6 });
  assert.throws(() => sanitizeDiscussionSettings({ version: 6, history: '不再发送' }), /只保存版本标记/);
});

test('legacy entry marks are inert and new content uses the native round condition', () => {
  assert.equal(discussionPromptMode({ id: 'custom', extra: { destined_mode: 'discussion' } }), 'discussion');
  assert.equal(discussionPromptMode({ id: 'worldInfoBefore' }), 'story');
  assert.equal(discussionPromptMode({ id: 'custom' }), 'story');
  assert.equal(wrapDiscussionCondition('正文'), '{{if {{getvar::本轮场外讨论}}}}正文{{/if}}');
});

test('v1 and v2 migrate only when requested, retain text, and omit fake reference/history slots', () => {
  const v1 = { extensions: { destined_discussion: { version: 1, prompts: { head: '旧头部', tail: '旧尾部', history: '旧历史', geminiTail: 'Gemini 保留' } } } };
  const v2 = structuredClone(defaults());
  v2.entries[1].content = '自定义规则'; v2.history = 'v2 历史';
  const fromV1 = buildNativeDiscussionMigration(v1, defaults());
  assert.deepEqual(fromV1.prompts.map(prompt => prompt.id), ['destined-discussion-head', 'destined-discussion-rules', 'destined-discussion-thinking', 'destined-discussion-analysis', 'destined-discussion-tail']);
  assert.equal(fromV1.prompts[0].content, '旧头部');
  assert.equal(fromV1.prompts.at(-1).content, '旧尾部');
  assert.deepEqual(fromV1.extension, { version: 6 });
  const fromV2 = buildNativeDiscussionMigration({ extensions: { destined_discussion: v2 } }, defaults());
  assert.equal(fromV2.prompts[1].content, '{{if {{getvar::本轮场外讨论}}}}自定义规则{{/if}}');
  assert.deepEqual(fromV2.extension, { version: 6 });
  assert(fromV2.prompts.every(prompt => prompt.content.includes('{{getvar::本轮场外讨论}}')));
});

test('native config exposes raw prompt arrays without creating a private prompt collection', () => {
  const preset = { prompts: [{ id: 'a' }], prompts_unused: [{ id: 'b' }], extensions: { destined_discussion: { version: 4, history: 'H' } } };
  const config = readNativeDiscussionConfig(preset);
  assert.equal(config.prompts, preset.prompts);
  assert.equal(config.prompts_unused, preset.prompts_unused);
  assert.equal(config.history, 'H');
});
