import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTINUE_CLOSE,
  CONTINUE_INSTRUCTION,
  CONTINUE_OPEN,
  continuationInstruction,
  DOCUMENT_END,
  MAX_ROUNDS,
  continuationBody,
  TOOL_OUTPUT_MARKER,
  TOOL_OUTPUT_NAME,
  createArgumentReader,
  installToolOutputTransport,
  prepareToolOutputRequest,
} from '../src/preset/tool-output.js';

const DOC = '<recorder_output>\n<recorder_body>\n第一行 "引号" \\反斜杠 😀 结尾\n</recorder_body>\n</recorder_output>';
const GENERATE = '/api/backends/chat-completions/generate';
const encoder = new TextEncoder();

function eventStream(payloads, chunkSize = 7) {
  const bytes = encoder.encode(payloads.map(payload => 'data: ' + JSON.stringify(payload) + '\n\n').join('') + 'data: [DONE]\n\n');
  // Fixed byte slices split lines, JSON and multi-byte characters.
  return new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

async function readText(response) {
  let text = '';
  let toolCallLeft = false;
  for (const line of (await response.text()).split('\n')) {
    const data = /^data: (.*)$/u.exec(line);
    if (!data || data[1] === '[DONE]') continue;
    const payload = JSON.parse(data[1]);
    for (const choice of payload.choices ?? []) {
      text += choice.delta?.content ?? '';
      if (choice.delta?.tool_calls) toolCallLeft = true;
    }
    for (const candidate of payload.candidates ?? []) {
      for (const part of candidate.content.parts) {
        text += part.text ?? '';
        if (part.functionCall) toolCallLeft = true;
      }
    }
  }
  return { text, toolCallLeft };
}

function fakeHost(respond) {
  const sent = [];
  const host = { fetch: async (_input, init) => { sent.push(JSON.parse(init.body)); return respond(sent.at(-1), sent.length); } };
  const results = [];
  const transport = installToolOutputTransport({ host, onResult: stats => results.push(stats) });
  const send = (body, url = GENERATE) => host.fetch(url, { method: 'POST', body: JSON.stringify(body) });
  return { host, sent, results, transport, send };
}

const TAIL_CONTINUATION = 'Now deliver the body, starting with <recorder_body>.';
// The two-call tail carries a continuation block; the one-call tail does not.
const markedMessages = ({ split = true } = {}) => [
  { role: 'user', content: 'story' },
  { role: 'system', content: TOOL_OUTPUT_MARKER + '\nDeliver through the tool.' + (split ? '\n' + CONTINUE_OPEN + '\n' + TAIL_CONTINUATION + '\n' + CONTINUE_CLOSE + '\n' : '') },
];

test('requests without the marker are left alone', () => {
  assert.equal(prepareToolOutputRequest({ messages: [{ role: 'user', content: 'hi' }] }), null);
  assert.equal(prepareToolOutputRequest({ prompt: 'text' }), null);
});

test('marked requests gain one tool and lose the marker', () => {
  const existing = { type: 'function', function: { name: 'other_tool' } };
  const { body, active } = prepareToolOutputRequest({ messages: markedMessages(), tools: [existing, { type: 'function', function: { name: TOOL_OUTPUT_NAME } }] });
  assert.equal(active, true);
  assert.equal(body.messages[1].content, 'Deliver through the tool.');
  assert.deepEqual(body.tools.map(tool => tool.function.name), ['other_tool', TOOL_OUTPUT_NAME]);
  assert.equal(body.tool_choice, 'auto');
});

test('array content parts are stripped too', () => {
  const { body } = prepareToolOutputRequest({ messages: [{ role: 'system', content: [{ type: 'text', text: 'a ' + TOOL_OUTPUT_MARKER + ' b' }, { type: 'image_url', image_url: {} }] }] });
  assert.equal(body.messages[0].content[0].text, 'a b');
  assert.equal(body.messages[0].content[1].type, 'image_url');
});

test('a caller that pins tool choice keeps it, without the marker', () => {
  const { body, active } = prepareToolOutputRequest({ messages: markedMessages(), tool_choice: 'none' });
  assert.equal(active, false);
  assert.equal(body.tool_choice, 'none');
  assert.equal(body.tools, undefined);
  assert.ok(!JSON.stringify(body).includes(TOOL_OUTPUT_MARKER));
});

test('argument reader decodes escapes and surrogate pairs split across fragments', () => {
  const source = JSON.stringify({ content: DOC });
  for (const size of [1, 2, 3, 5, 11]) {
    const reader = createArgumentReader();
    let text = '';
    for (let index = 0; index < source.length; index += size) text += reader.push(source.slice(index, index + size));
    assert.equal(text, DOC, 'fragment size ' + size);
    assert.equal(reader.closed, true);
  }
  const split = createArgumentReader();
  assert.equal(split.push('{"content":"a\\ud83d'), 'a');
  assert.equal(split.push('\\ude00"}'), '😀');
});

test('streamed OpenAI-style tool arguments become text deltas', async () => {
  const source = JSON.stringify({ content: DOC });
  const payloads = [];
  for (let index = 0; index < source.length; index += 4) {
    const first = index === 0;
    payloads.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...(first ? { id: 'call', type: 'function' } : {}), function: { ...(first ? { name: TOOL_OUTPUT_NAME } : {}), arguments: source.slice(index, index + 4) } }] } }] });
  }
  payloads.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  const { sent, results, send } = fakeHost(() => eventStream(payloads));
  const response = await send({ messages: markedMessages(), stream: true });
  const { text, toolCallLeft } = await readText(response);
  assert.equal(text, DOC);
  assert.equal(toolCallLeft, false);
  assert.equal(sent[0].tools.at(-1).function.name, TOOL_OUTPUT_NAME);
  assert.equal(results.length, 1);
  assert.equal(results[0].used, true);
  assert.equal(results[0].streamed, true);
  assert.ok(results[0].toolChunks > 1);
});

test('Google partial arguments stream while thoughts pass through', async () => {
  const pieces = ['<recorder_output>\n<recorder_body>\n第一行 "引号"', ' \\反斜杠 😀 结尾\n', '</recorder_body>\n</recorder_output>'];
  const payloads = [
    { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking', thought: true }] } }] },
    ...pieces.map((piece, index) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { ...(index === 0 ? { name: TOOL_OUTPUT_NAME } : {}), partialArgs: [{ jsonPath: '$.content', stringValue: piece }], willContinue: index < 2 } }] } }] })),
  ];
  const { results, send } = fakeHost(() => eventStream(payloads, 5));
  const { text, toolCallLeft } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, 'thinking' + DOC);
  assert.equal(toolCallLeft, false);
  assert.equal(results[0].toolChunks, 3);
});

test('Google whole arguments arrive as one text part', async () => {
  const payload = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: TOOL_OUTPUT_NAME, args: { content: DOC } } }] }, finishReason: 'STOP' }] };
  const { results, send } = fakeHost(() => eventStream([payload]));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, DOC);
  assert.equal(results[0].toolChunks, 1);
});

test('non-streamed responses are restored', async () => {
  const body = { choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: TOOL_OUTPUT_NAME, arguments: JSON.stringify({ content: DOC }) } }] }, finish_reason: 'tool_calls' }] };
  const { results, send } = fakeHost(() => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const restored = await (await send({ messages: markedMessages(), stream: false })).json();
  assert.equal(restored.choices[0].message.content, DOC);
  assert.equal(restored.choices[0].message.tool_calls, undefined);
  assert.equal(restored.choices[0].finish_reason, 'stop');
  assert.equal(results[0].streamed, false);
});

test('plain replies pass through and are reported as unused', async () => {
  const { sent, results, send } = fakeHost(() => eventStream([{ choices: [{ index: 0, delta: { content: DOC } }] }]));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, DOC);
  assert.equal(sent.length, 1);
  assert.equal(results[0].used, false);
  assert.equal(results[0].plainChars, DOC.length);
  assert.equal(results[0].stopReason, 'complete');
});

test('a plain-text audit is continued like a tool-delivered one', async () => {
  const { sent, results, send } = fakeHost((_body, count) => count === 1
    ? eventStream([{ choices: [{ index: 0, delta: { content: THINKING } }] }])
    : eventStream(streamedOpenAiCalls([BODY.join('')])));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, THINKING + BODY.join(''));
  assert.equal(sent[1].messages.at(-2).content, THINKING);
  assert.equal(results[0].stopReason, 'complete');
});

test('a document closed right after the audit is held back and continued', async () => {
  // The close tag arrives split across fragments and is never shown mid-reply.
  const closed = THINKING + '</recorder_output>';
  const { sent, send } = fakeHost((_body, count) => eventStream(streamedOpenAiCalls([count === 1 ? closed : BODY.join('')])));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, THINKING + BODY.join(''));
  assert.equal(sent[1].messages.at(-2).content, THINKING);

  const alone = fakeHost(() => eventStream(streamedOpenAiCalls([closed])));
  const { text: kept } = await readText(await alone.send({ messages: markedMessages(), stream: true }));
  // Without a body ever arriving the held tag is released at the end.
  assert.equal(kept.replace(/\n/gu, ''), (THINKING.repeat(MAX_ROUNDS) + '</recorder_output>').replace(/\n/gu, ''));
});

test('other tool calls stay untouched', async () => {
  const payload = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'other_tool', arguments: '{}' } }] } }] };
  const { send } = fakeHost(() => eventStream([payload]));
  const { toolCallLeft } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(toolCallLeft, true);
});

test('unrelated requests and error responses pass through', async () => {
  const { sent, results, send } = fakeHost(() => new Response('{"error":"bad"}', { status: 400, headers: { 'content-type': 'application/json' } }));
  await send({ a: 1 }, '/api/settings/save');
  assert.deepEqual(sent[0], { a: 1 });
  const response = await send({ messages: markedMessages(), stream: true });
  assert.equal(response.status, 400);
  assert.equal(results.length, 0);
});

const THINKING = '<recorder_output>\n<recorder_thinking>\n检查 "要点"\n</recorder_thinking>\n';
const BODY = ['<recorder_body>\n第一段 😀\n', '第二段\n</recorder_body>\n</recorder_output>'];

const openAiCall = (index, args, named) => ({ index, ...(named ? { id: 'call' + index, type: 'function' } : {}), function: { ...(named ? { name: TOOL_OUTPUT_NAME } : {}), arguments: args } });
function streamedOpenAiCalls(contents, { withIndex = true } = {}) {
  const payloads = [];
  contents.forEach((content, call) => {
    const source = JSON.stringify({ content });
    for (let offset = 0; offset < source.length; offset += 5) {
      const fragment = openAiCall(withIndex ? call : undefined, source.slice(offset, offset + 5), offset === 0);
      if (!withIndex) delete fragment.index;
      payloads.push({ choices: [{ index: 0, delta: { tool_calls: [fragment] } }] });
    }
  });
  payloads.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  return payloads;
}

test('sequential OpenAI-style calls join in order, with or without an index', async () => {
  for (const withIndex of [true, false]) {
    const { results, send } = fakeHost(() => eventStream(streamedOpenAiCalls([THINKING, ...BODY], { withIndex })));
    const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
    assert.equal(text, THINKING + BODY.join(''), 'withIndex ' + withIndex);
    assert.equal(results[0].calls, 3);
    assert.equal(results[0].arrivals.length, results[0].toolChunks);
  }
});

test('a join that lands mid-line keeps a line break', async () => {
  const { send } = fakeHost(() => eventStream(streamedOpenAiCalls(['<recorder_thinking>A</recorder_thinking>', '<recorder_body>B</recorder_output>'])));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, '<recorder_thinking>A</recorder_thinking>\n<recorder_body>B</recorder_output>');
});

test('Google whole calls in separate chunks join in order', async () => {
  const payloads = [THINKING, ...BODY].map(content => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: TOOL_OUTPUT_NAME, args: { content } } }] } }] }));
  const { results, send } = fakeHost(() => eventStream(payloads, 9));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, THINKING + BODY.join(''));
  assert.equal(results[0].calls, 3);
});

test('Google partial calls continue across named chunks until willContinue ends', async () => {
  const chunk = (piece, willContinue) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: TOOL_OUTPUT_NAME, partialArgs: [{ jsonPath: '$.content', stringValue: piece }], willContinue } }] } }] });
  const payloads = [chunk('<recorder_thinking>甲', true), chunk('乙</recorder_thinking>', false), chunk('<recorder_body>丙', true), chunk('丁</recorder_output>', false)];
  const { results, send } = fakeHost(() => eventStream(payloads));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, '<recorder_thinking>甲乙</recorder_thinking>\n<recorder_body>丙丁</recorder_output>');
  assert.equal(results[0].calls, 2);
});

test('a non-streamed message with several calls is joined', async () => {
  const calls = [THINKING, ...BODY].map((content, index) => ({ id: 'c' + index, type: 'function', function: { name: TOOL_OUTPUT_NAME, arguments: JSON.stringify({ content }) } }));
  const body = { choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: 'tool_calls' }] };
  const { send } = fakeHost(() => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const restored = await (await send({ messages: markedMessages(), stream: false })).json();
  assert.equal(restored.choices[0].message.content, THINKING + BODY.join(''));
});

const rawLines = async response => (await response.text()).split('\n').filter(line => line.startsWith('data:'));

test('a reply that stops after the audit is continued in a second request', async () => {
  const rounds = [[THINKING], [BODY.join('')]];
  const { sent, results, send } = fakeHost((_body, count) => eventStream(streamedOpenAiCalls(rounds[count - 1])));
  const response = await send({ messages: markedMessages(), stream: true });
  const lines = await rawLines(response.clone());
  const { text } = await readText(response);
  assert.equal(text, THINKING + BODY.join(''));
  assert.equal(sent.length, 2);
  const followUp = sent[1].messages.slice(-2);
  assert.deepEqual(followUp.map(message => message.role), ['assistant', 'user']);
  assert.equal(followUp[0].content, THINKING);
  assert.equal(followUp[1].content, TAIL_CONTINUATION);
  assert.equal(sent[1].tools.at(-1).function.name, TOOL_OUTPUT_NAME);
  assert.ok(!JSON.stringify(sent[1]).includes(TOOL_OUTPUT_MARKER));
  // Only the final round ends the host's stream.
  assert.equal(lines.filter(line => line.includes('[DONE]')).length, 1);
  assert.ok(lines.at(-1).includes('[DONE]'));
  assert.equal(results[0].rounds, 2);
  assert.equal(results[0].calls, 2);
});

test('continuation stops at the round limit, on plain text, or on an empty round', async () => {
  const unfinished = fakeHost((_body, count) => eventStream(streamedOpenAiCalls(['part ' + count + '\n'])));
  const limited = await readText(await unfinished.send({ messages: markedMessages(), stream: true }));
  assert.equal(unfinished.sent.length, MAX_ROUNDS);
  assert.equal(limited.text, 'part 1\npart 2\npart 3\n');

  const plain = fakeHost((_body, count) => count === 1
    ? eventStream(streamedOpenAiCalls([THINKING]))
    : eventStream([{ choices: [{ index: 0, delta: { content: BODY.join('') } }] }]));
  assert.equal((await readText(await plain.send({ messages: markedMessages(), stream: true }))).text, THINKING + BODY.join(''));
  assert.equal(plain.sent.length, 2);

  const empty = fakeHost((_body, count) => eventStream(streamedOpenAiCalls([count === 1 ? THINKING : ''])));
  await readText(await empty.send({ messages: markedMessages(), stream: true }));
  assert.equal(empty.sent.length, 2);
});

test('a failed continuation keeps the audit and reports the round', async () => {
  const host = {};
  const sent = [];
  host.fetch = async (_input, init) => {
    sent.push(JSON.parse(init.body));
    return sent.length === 1 ? eventStream(streamedOpenAiCalls([THINKING])) : new Response('gateway timeout 524', { status: 524 });
  };
  const errors = [], timeouts = [], results = [];
  installToolOutputTransport({ host, onRoundError: info => errors.push(info), onTimeout: info => timeouts.push(info), onResult: stats => results.push(stats) });
  const { text } = await readText(await host.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: markedMessages(), stream: true }) }));
  assert.equal(text, THINKING);
  assert.deepEqual(errors, [{ status: 524, round: 2 }]);
  assert.deepEqual(timeouts, [{ status: 524 }]);
  assert.equal(results[0].rounds, 2);
});

test('stopping during a continuation ends the reply without another round', async () => {
  const controller = new AbortController();
  const sent = [];
  const host = {
    fetch: async (_input, init) => {
      sent.push(init);
      if (sent.length === 1) return eventStream(streamedOpenAiCalls([THINKING]));
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  };
  installToolOutputTransport({ host });
  const response = await host.fetch(GENERATE, { method: 'POST', signal: controller.signal, body: JSON.stringify({ messages: markedMessages(), stream: true }) });
  await assert.rejects(response.text(), { name: 'AbortError' });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].signal, controller.signal);
});

test('non-streamed rounds merge into the first response', async () => {
  const json = content => new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: TOOL_OUTPUT_NAME, arguments: JSON.stringify({ content }) } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } });
  const rounds = [THINKING, BODY.join('')];
  const { sent, send } = fakeHost((_body, count) => json(rounds[count - 1]));
  const restored = await (await send({ messages: markedMessages(), stream: false })).json();
  assert.equal(restored.choices[0].message.content, THINKING + BODY.join(''));
  assert.equal(sent.length, 2);
});

test('the one-call tail never sends a follow-up request', async () => {
  const { sent, results, send } = fakeHost(() => eventStream(streamedOpenAiCalls([THINKING])));
  const { text } = await readText(await send({ messages: markedMessages({ split: false }), stream: true }));
  assert.equal(text, THINKING);
  assert.equal(sent.length, 1);
  assert.equal(results[0].stopReason, 'single');
  assert.equal(results[0].split, false);
});

test('the tail continuation is used after the audit, the built-in one after a cut body', () => {
  const { body, continuation } = prepareToolOutputRequest({ messages: markedMessages() });
  assert.equal(continuation, TAIL_CONTINUATION);
  assert.equal(body.messages[1].content, 'Deliver through the tool.');
  assert.ok(!JSON.stringify(body).includes(CONTINUE_OPEN) && !JSON.stringify(body).includes(CONTINUE_CLOSE));
  assert.equal(continuationInstruction(THINKING, continuation), TAIL_CONTINUATION);
  assert.equal(continuationInstruction(THINKING + '<recorder_body>\npart', continuation), CONTINUE_INSTRUCTION);
  assert.equal(prepareToolOutputRequest({ messages: markedMessages({ split: false }) }).continuation, '');
});

test('a body cut short is resumed with the built-in instruction', async () => {
  const rounds = [[THINKING], ['<recorder_body>\n第一段\n'], ['第二段\n</recorder_body>\n</recorder_output>']];
  const { sent, send } = fakeHost((_body, count) => eventStream(streamedOpenAiCalls(rounds[count - 1])));
  const { text } = await readText(await send({ messages: markedMessages(), stream: true }));
  assert.equal(text, THINKING + '<recorder_body>\n第一段\n第二段\n</recorder_body>\n</recorder_output>');
  assert.equal(sent[1].messages.at(-1).content, TAIL_CONTINUATION);
  assert.equal(sent[2].messages.at(-1).content, CONTINUE_INSTRUCTION);
});

test('continuation body appends the delivered text and the instruction', () => {
  const body = continuationBody({ messages: [{ role: 'user', content: 'u' }], tools: [] }, 'so far');
  assert.deepEqual(body.messages.slice(1), [{ role: 'assistant', content: 'so far' }, { role: 'user', content: CONTINUE_INSTRUCTION }]);
  assert.ok(CONTINUE_INSTRUCTION.includes(DOCUMENT_END));
});

test('a 524 timeout on a tool-output request is reported', async () => {
  for (const respond of [
    () => new Response('timeout', { status: 524 }),
    () => new Response('{"error":{"message":"Streaming request failed with status 524"}}', { status: 500, headers: { 'content-type': 'application/json' } }),
  ]) {
    const host = { fetch: async () => respond() };
    const timeouts = [];
    installToolOutputTransport({ host, onTimeout: info => timeouts.push(info) });
    const response = await host.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: markedMessages(), stream: true }) });
    // The host still reads the untouched error body.
    assert.match(await response.text(), /524|timeout/u);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(timeouts, [{ status: 524 }]);
  }
  const host = { fetch: async () => new Response('bad', { status: 500 }) };
  const timeouts = [];
  installToolOutputTransport({ host, onTimeout: info => timeouts.push(info) });
  await host.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'plain' }] }) });
  await host.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: markedMessages() }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(timeouts, []);
});

test('dispose restores fetch, or passes through once wrapped again', async () => {
  const { host, sent, transport } = fakeHost(() => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const wrapped = host.fetch;
  transport.dispose();
  assert.notEqual(host.fetch, wrapped);
  await host.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: markedMessages() }) });
  assert.equal(sent[0].tools, undefined);

  const second = fakeHost(() => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const outer = second.host.fetch;
  second.host.fetch = (...args) => outer(...args);
  second.transport.dispose();
  await second.send({ messages: markedMessages() });
  assert.equal(second.sent[0].tools, undefined);
});

test('stacked transports add the tool once and restore once', async () => {
  const source = JSON.stringify({ content: DOC });
  const { host, sent, results } = fakeHost(() => eventStream([{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: TOOL_OUTPUT_NAME, arguments: source } }] } }] }]));
  const outerResults = [];
  installToolOutputTransport({ host, onResult: stats => outerResults.push(stats) });
  const { text } = await readText(await host.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: markedMessages(), stream: true }) }));
  assert.equal(text, DOC);
  assert.equal(sent[0].tools.filter(tool => tool.function.name === TOOL_OUTPUT_NAME).length, 1);
  // The outer wrapper consumes the marker, so the inner one stays out of the way.
  assert.equal(outerResults.length, 1);
  assert.equal(results.length, 0);
});
