import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscussionMessageAccess } from '../src/discussion/messages.js';
import { createDiscussionController } from '../src/discussion/controller.js';
import { isDiscussionMessage, wrapDiscussion } from '../src/discussion/protocol.js';

function setup(body = '## 建议\n修改后续动机') {
  const extra = { reasoning: '原生思考', reasoning_signature: 'fixture-signature', image: 'fixture-image' };
  const chat = [{ mes: body, extra, swipe_id: 1, swipes: ['另一页', body], swipe_info: [
    { send_date: 'old', extra: { reasoning: '另一页思考' } },
    { send_date: 'current', gen_started: 100, gen_finished: 200, extra: structuredClone(extra) },
  ] }];
  const calls = [];
  // JS-Slash-Runner 4.9.5 exposes native swipe_info records directly, not their extra field.
  const getMessages = (id, options = {}) => {
    const raw = chat[id];
    if (!raw) return [];
    const result = { message_id: id, role: 'assistant', swipe_id: raw.swipe_id };
    return [structuredClone(options.include_swipes
      ? { ...result, swipes: raw.swipes, swipes_info: raw.swipe_info }
      : { ...result, message: raw.mes, extra: raw.swipe_info[raw.swipe_id] })];
  };
  const access = createDiscussionMessageAccess({ getContext: () => ({ chat }), getMessages,
    setMessages: async updates => {
      calls.push(structuredClone(updates));
      for (const update of updates) {
        assert.deepEqual(Object.keys(update).sort(), ['message', 'message_id']);
        chat[update.message_id].mes = update.message;
        chat[update.message_id].swipes[chat[update.message_id].swipe_id] = update.message;
      }
    },
  });
  const controller = createDiscussionController({ contextKey: () => 'chat', readMode: () => 'discussion',
    readMessage: access.read, writeMessage: access.write, lastMessageId: () => -1, compatible: () => true });
  return { chat, access, controller, calls, getMessages };
}

test('discussion completion wraps the body without replacing native reasoning, swipe dates or other pages', async () => {
  const { chat, controller: c, getMessages } = setup();
  const raw = chat[0], extraReference = raw.extra, infoReference = raw.swipe_info[1];
  const original = structuredClone(raw);
  c.start('normal'); await c.received(0); await c.ended(0);
  assert.equal(raw.mes, wrapDiscussion(original.mes));
  assert.equal(raw.extra, extraReference);
  assert.equal(raw.swipe_info[1], infoReference);
  for (const [key, value] of Object.entries(original.extra)) assert.deepEqual(raw.extra[key], value);
  assert.equal(raw.swipe_info[1].send_date, 'current');
  assert.equal(raw.swipe_info[1].gen_finished, 200);
  assert.deepEqual(raw.swipe_info[0], original.swipe_info[0]);
  assert.equal(raw.swipes[0], original.swipes[0]);
  assert(isDiscussionMessage(raw));
  assert(isDiscussionMessage(getMessages(0)[0]), 'summary helper snapshot recognizes nested native metadata');
});

test('stopping a discussion preserves partial text and native reasoning as distinct fields', async () => {
  const { chat, controller: c } = setup('尚未写完的建议');
  c.start('normal'); await c.ended(); await c.receivedFinal(0);
  assert.equal(chat[0].mes, wrapDiscussion('尚未写完的建议'));
  assert.equal(chat[0].extra.reasoning, '原生思考');
  assert.equal(chat[0].swipe_info[1].extra.reasoning, '原生思考');
});

test('empty native body does not erase an existing native reasoning field when tagged', async () => {
  const { chat, controller: c } = setup('');
  c.start('normal'); await c.ended(0);
  assert.equal(chat[0].extra.reasoning, '原生思考');
  assert.equal(chat[0].extra.reasoning_signature, 'fixture-signature');
});

test('late writes to a changed swipe are rejected without mutating any native data', async () => {
  const { chat, access } = setup();
  const original = structuredClone(chat);
  await assert.rejects(access.write({ message_id: 0, swipe_id: 0, swipes: ['wrong'], swipes_info: [{}] }), /回复页/);
  assert.deepEqual(chat, original);
});
