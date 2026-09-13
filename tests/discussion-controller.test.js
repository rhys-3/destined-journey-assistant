import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscussionController } from '../src/discussion/controller.js';
import { DISCUSSION_CLOSE, DISCUSSION_OPEN, LEGACY_DISCUSSION_CLOSE, LEGACY_DISCUSSION_OPEN, hasDiscussionWrapper, wrapDiscussion, isDiscussionMessage } from '../src/discussion/protocol.js';
import { suppressDiscussionCommands } from '../src/discussion/variables.js';

function setup() {
  let context = 'chat-a', mode = 'story', compatible = true;
  const messages = [{ message_id: 0, role: 'assistant', message: '开局', extra: { unrelated: true } }];
  const notices = [], writes = [];
  const controller = createDiscussionController({
    contextKey: () => context, readMode: () => mode, writeMode: next => { mode = next; }, compatible: () => compatible,
    lastMessageId: () => messages.length - 1,
    readMessage: id => messages[id] ? structuredClone(messages[id]) : null,
    writeMessage: update => {
      writes.push(update); Object.assign(messages[update.message_id], structuredClone(update));
      if (update.swipes) {
        messages[update.message_id].message = update.swipes[update.swipe_id];
        messages[update.message_id].extra = structuredClone(update.swipes_info[update.swipe_id]);
      }
    },
    notify: message => notices.push(message),
  });
  return { controller, messages, notices, writes, context: value => { context = value; }, compatibility: value => { compatible = value; } };
}
test('discussion toggles persist, lock during generation, wrap only new messages and preserve other metadata', async () => {
  const { controller: c, messages, notices } = setup();
  assert.equal(c.mode, 'story'); await c.toggle(); assert.equal(c.mode, 'discussion');
  c.start('normal'); await assert.rejects(c.toggle(), /生成结束/);
  messages.push({ message_id: 1, role: 'user', message: '改动机', extra: { keep: 1 } });
  await c.sent(1);
  messages.push({ message_id: 2, role: 'assistant', message: '建议', extra: {}, swipe_id: 0, swipes: ['建议'], swipes_info: [{}] });
  await c.received(2); assert.equal(messages[2].message, '建议', 'streaming reply remains native until generation ends'); await c.ended(2);
  assert.equal(c.busy, false); assert.equal(messages[1].message, wrapDiscussion('改动机'));
  assert.equal(messages[1].extra.keep, 1);
  assert.equal(messages[2].swipes[0], wrapDiscussion('建议'));
  assert.equal(messages[2].swipes_info[0].destined_discussion.mode, 'discussion');
  await c.toggle(); assert.equal(c.mode, 'story');
  assert(isDiscussionMessage(messages[1])); assert.deepEqual(notices, []);
});
test('swipe, regenerate and continue retain target mode even after switching back to story', async () => {
  const { controller: c, messages } = setup();
  messages[0].extra.destined_discussion = { version: 1, mode: 'discussion' };
  messages[0].message = wrapDiscussion('旧讨论');
  for (const type of ['swipe', 'regenerate', 'continue']) {
    c.start(type); assert.equal(c.requestMode(), 'discussion');
    messages[0].message = '新讨论'; await c.ended(); await c.receivedFinal(0);
    assert(isDiscussionMessage(messages[0])); assert.equal(messages[0].message, wrapDiscussion('新讨论'));
  }
  c.start('normal'); assert.equal(c.requestMode(), 'story'); await c.ended(0);
  assert(isDiscussionMessage(messages[0]), 'cancelled normal generation must not retag previous reply');
});
test('preview and silent requests do not lock; incompatible discussion fails and story remains available', async () => {
  const { controller: c, compatibility } = setup();
  c.start('normal', {}, true); assert.equal(c.busy, false);
  c.start('quiet'); assert.equal(c.busy, false);
  compatibility(false); await assert.rejects(c.toggle(), /配套/); assert.equal(c.requestMode(), 'story');
  compatibility(true); await c.toggle(); compatibility(false);
  assert.throws(() => c.requestMode(), /配套/);
});
test('queued writes and late responses cannot affect a different chat', async () => {
  const { controller: c, messages, context, writes } = setup();
  await c.toggle(); c.start('normal');
  messages.push({ message_id: 1, role: 'user', message: '讨论', extra: {} });
  const pending = c.sent(1);
  context('chat-b'); c.contextChanged(); await pending;
  messages.push({ message_id: 2, role: 'assistant', message: '迟到', extra: {} });
  await c.received(2); assert.deepEqual(writes, []);
  assert.equal(messages[1].message, '讨论');
});
test('editing a discussion preserves a single wrapper; normal XML content is not auto-classified', async () => {
  const { controller: c, messages } = setup();
  await c.edited(0); assert(!isDiscussionMessage(messages[0]));
  messages[0].extra.destined_discussion = { version: 1, mode: 'discussion' };
  messages[0].message = wrapDiscussion('编辑稿');
  await c.edited(0); await c.edited(0);
  assert.equal(messages[0].message, wrapDiscussion('编辑稿'));
});

test('old records are read but edits normalize to the new wrapper without scanning unrelated content', async () => {
  const { controller: c, messages } = setup();
  messages[0].extra.destined_discussion = { version: 1, mode: 'discussion' };
  messages[0].message = `${LEGACY_DISCUSSION_OPEN}\n旧记录\n${LEGACY_DISCUSSION_CLOSE}`;
  await c.edited(0);
  assert.equal(messages[0].message, `${DISCUSSION_OPEN}\n旧记录\n${DISCUSSION_CLOSE}`);
  assert(hasDiscussionWrapper(`${LEGACY_DISCUSSION_OPEN}\n旧记录\n${LEGACY_DISCUSSION_CLOSE}\n<UpdateVariable>late</UpdateVariable>`));
  for (const value of ['```xml\n<discussion_record>示例</discussion_record>\n```', '> <discussion_record>引用</discussion_record>', '文字 <discussion_record>内嵌</discussion_record>', '<discussion_record>缺少闭合']) assert(!hasDiscussionWrapper(value));
});

test('MVU discards discussion commands including late extra-model appends, leaving story commands and data intact', () => {
  const variables = { stat_data: { hp: 20 } };
  for (const text of [wrapDiscussion('讨论'), wrapDiscussion('讨论') + '\n<UpdateVariable>late patch</UpdateVariable>', `${LEGACY_DISCUSSION_OPEN}\n旧讨论\n${LEGACY_DISCUSSION_CLOSE}\n<UpdateVariable>late patch</UpdateVariable>`]) {
    const commands = [{ type: 'set', path: 'hp', value: 0 }];
    suppressDiscussionCommands(variables, commands, text);
    assert.deepEqual(commands, []); assert.equal(variables.stat_data.hp, 20);
    const wrapped = wrapDiscussion(text);
    assert.equal(wrapped.match(/<discussion_record>/g).length, 1);
  }
  const commands = [{ type: 'set', path: 'hp', value: 15 }];
  suppressDiscussionCommands(variables, commands, '<gametxt>剧情</gametxt>');
  assert.equal(commands.length, 1);
});
test('native pending swipe inherits the previously viewed reply without creating its empty page', async () => {
  const { controller: c, messages, writes } = setup();
  messages[0] = { ...messages[0], message: wrapDiscussion('讨论页'), extra: { destined_discussion: { version: 1, mode: 'discussion' } }, swipe_id: 0, swipes: [wrapDiscussion('讨论页')], swipes_info: [{}] };
  c.observe(0);
  messages[0].swipe_id = 1;
  await c.edited(0);
  assert.equal(messages[0].swipes.length, 1); assert.deepEqual(writes, []);
  c.start('swipe'); assert.equal(c.requestMode(), 'discussion');
  messages[0].swipes.push('新建议'); messages[0].message = '新建议';
  await c.ended(); await c.receivedFinal(0);
  assert.equal(messages[0].swipes[1], wrapDiscussion('新建议'));
});

test('stopped generation writes the final candidate once while frozen discussion still blocks MVU updates', async () => {
  const { controller: c, messages } = setup(); await c.toggle(); c.start('normal');
  messages.push({ message_id: 1, role: 'assistant', message: '部分回复', extra: {} });
  await c.received(1); assert.equal(messages[1].message, '部分回复');
  const commands = [{ type: 'set', path: 'hp', value: 0 }];
  suppressDiscussionCommands({}, commands, messages[1].message, c.requestMode() === 'discussion');
  assert.deepEqual(commands, []);
  await c.ended(1); assert.equal(messages[1].message, wrapDiscussion('部分回复'));
});

test('pending MVU protection is bound to the captured discussion floor and current swipe', async () => {
  const { controller: c, messages } = setup();
  messages[0] = { ...messages[0], message: '旧剧情迟到结果', extra: {} };
  await c.toggle(); c.start('normal');
  messages.push({ message_id: 1, role: 'assistant', message: '当前讨论回复', extra: {}, swipe_id: 0, swipes: ['当前讨论回复'], swipes_info: [{}] });
  await c.received(1);
  assert.equal(c.isPendingDiscussionSource('当前讨论回复'), true);
  assert.equal(c.isPendingDiscussionSource('旧剧情迟到结果'), false);
  messages[1].swipe_id = 1;
  assert.equal(c.isPendingDiscussionSource('当前讨论回复'), false);
  messages[1].swipe_id = 0;
  await c.ended(1);
  assert.equal(c.isPendingDiscussionSource('当前讨论回复'), false);
});

test('chat-length terminal waits for the final received floor and an empty terminal does not block retry', async () => {
  const { controller: c, messages } = setup();
  await c.toggle(); c.start('normal');
  await c.ended();
  assert.equal(c.busy, false, 'terminal token releases the next-send lock');
  messages.push({ message_id: 1, role: 'assistant', message: '最终讨论', extra: {}, swipe_id: 0, swipes: ['最终讨论'], swipes_info: [{}] });
  await c.received(1);
  assert.equal(messages[1].message, '最终讨论', 'first receive only freezes the source');
  await c.receivedFinal(1);
  assert.equal(messages[1].message, wrapDiscussion('最终讨论'));
  c.start('normal');
  await c.ended();
  assert.equal(c.busy, false);
  c.start('normal');
  assert.equal(c.busy, true, 'a no-reply terminal is replaced by the next native start');
});

test('recorder prefill contract freezes through terminal output and only marks the matching assistant swipe', async () => {
  const { controller: c, messages } = setup();
  await c.toggle(); c.start('normal');
  assert.deepEqual(c.requestOutput(), { mode: 'discussion', recorderPrefill: false });
  assert.equal(c.setRequestOutput({ recorderPrefill: true }), true);
  await c.ended();
  assert.deepEqual(c.requestOutput(), { mode: 'discussion', recorderPrefill: true }, 'terminal keeps the real request output contract');
  messages.push({ message_id: 1, role: 'assistant', message: '续写正文', extra: {}, swipe_id: 0, swipes: ['续写正文'], swipes_info: [{}] });
  await c.receivedFinal(1);
  assert.equal(messages[1].extra.destined_discussion.recorder_prefill, true);
  assert.equal(c.requestOutput(), null, 'completed output relies on its saved swipe metadata');
  await c.edited(1);
  assert.equal(messages[1].extra.destined_discussion.recorder_prefill, true, 'editing preserves an existing output contract');
  c.start('regenerate');
  messages[1].message = '新的完整正文'; messages[1].swipes[0] = '新的完整正文';
  await c.ended(); await c.receivedFinal(1);
  assert.equal(messages[1].extra.destined_discussion.recorder_prefill, undefined, 'a new swipe cannot inherit recorder prefill');
  c.start('normal'); c.setRequestOutput({ recorderPrefill: true });
  messages.push({ message_id: 2, role: 'user', message: '用户补充', extra: {} });
  await c.sent(2);
  assert.equal(messages[2].extra.destined_discussion.recorder_prefill, undefined, 'user floors never carry recorder prefill');
  await c.ended();
  c.start('normal');
  assert.deepEqual(c.requestOutput(), { mode: 'discussion', recorderPrefill: false }, 'retry starts with no inherited output contract');
});
