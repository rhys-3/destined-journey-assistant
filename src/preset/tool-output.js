// Tool-output transport. When an outgoing chat-completion prompt carries the
// tool-output marker, the request gains one function tool and the reply's
// function-call argument is turned back into ordinary assistant text before
// SillyTavern reads it. The host therefore renders, streams, swipes and
// continues the reply as a normal message and never runs its own tool calling.
//
// A tail that also carries a continuation block asks for the reply in two
// parts: the first request delivers the public audit, and a follow-up request
// built from that block delivers the rest. Without the block one request is made.

export const TOOL_OUTPUT_MARKER = '<|命定_工具输出|>';
export const CONTINUE_OPEN = '<|命定_续写开始|>';
export const CONTINUE_CLOSE = '<|命定_续写结束|>';
export const TOOL_OUTPUT_NAME = 'submit_recorder_output';
export const TOOL_OUTPUT_PARAM = 'content';

const GENERATE_PATH = /\/api\/backends\/chat-completions\/generate(?:[?#]|$)/u;
const escapeMarker = marker => marker.replace(/[|]/gu, '\\|');
const MARKER_LINE = new RegExp(escapeMarker(TOOL_OUTPUT_MARKER) + '[ \\t]*\\r?\\n?', 'gu');
const CONTINUE_BLOCK = new RegExp('\\s*' + escapeMarker(CONTINUE_OPEN) + '([\\s\\S]*?)' + escapeMarker(CONTINUE_CLOSE) + '[ \\t]*\\r?\\n?', 'gu');

const TOOL_DEFINITION = Object.freeze({
  type: 'function',
  function: {
    name: TOOL_OUTPUT_NAME,
    description: 'Deliver the visible reply of this turn, or the requested part of it.',
    parameters: {
      type: 'object',
      properties: {
        [TOOL_OUTPUT_PARAM]: { type: 'string', description: 'The reply text, or the requested part of it.' },
      },
      required: [TOOL_OUTPUT_PARAM],
    },
  },
});

function textParts(message) {
  if (typeof message?.content === 'string') return [message.content];
  if (!Array.isArray(message?.content)) return [];
  return message.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text);
}

function stripMarkers(message, continuations) {
  const strip = text => text.replace(MARKER_LINE, '').replace(CONTINUE_BLOCK, (_block, inner) => {
    continuations.push(inner.trim());
    return '';
  });
  if (typeof message?.content === 'string') return { ...message, content: strip(message.content) };
  if (!Array.isArray(message?.content)) return message;
  return {
    ...message,
    content: message.content.map(part => part?.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: strip(part.text) } : part),
  };
}

/** Returns the rewritten request body, or null when the request is not a tool-output request. */
export function prepareToolOutputRequest(body) {
  if (!body || !Array.isArray(body.messages)) return null;
  if (!body.messages.some(message => textParts(message).some(text => text.includes(TOOL_OUTPUT_MARKER)))) return null;
  // A caller that disables or pins tool use keeps control of the request.
  const choice = body.tool_choice;
  const callerPinned = choice === 'none' || choice === 'required' || (choice !== null && typeof choice === 'object');
  const continuations = [];
  const messages = body.messages.map(message => stripMarkers(message, continuations));
  const continuation = continuations.filter(Boolean).at(-1) ?? '';
  if (callerPinned) return { body: { ...body, messages }, active: false, continuation: '' };
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter(tool => tool?.function?.name !== TOOL_OUTPUT_NAME);
  return {
    body: { ...body, messages, tools: [...tools, structuredClone(TOOL_DEFINITION)], tool_choice: 'auto' },
    active: true,
    continuation,
  };
}

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Incrementally reads one string field from a JSON object that arrives in
 * fragments. Each push returns only the newly decoded characters; an escape or
 * surrogate pair split across fragments waits for the rest.
 */
export function createArgumentReader(field = TOOL_OUTPUT_PARAM) {
  const opening = new RegExp(`"${field}"\\s*:\\s*"`, 'u');
  let source = '';
  let position = -1;
  let closed = false;
  return {
    get closed() { return closed; },
    push(fragment) {
      if (closed || !fragment) return '';
      source += fragment;
      if (position < 0) {
        const found = opening.exec(source);
        if (!found) return '';
        position = found.index + found[0].length;
      }
      let decoded = '';
      let lastStart = position;
      while (position < source.length) {
        const char = source[position];
        if (char === '"') { closed = true; position += 1; break; }
        if (char !== '\\') { lastStart = position; decoded += char; position += 1; continue; }
        const kind = source[position + 1];
        if (kind === undefined) break;
        if (kind === 'u') {
          const hex = source.slice(position + 2, position + 6);
          if (hex.length < 4) break;
          lastStart = position;
          decoded += String.fromCharCode(Number.parseInt(hex, 16));
          position += 6;
          continue;
        }
        lastStart = position;
        decoded += ESCAPES[kind] ?? kind;
        position += 2;
      }
      const tail = decoded.charCodeAt(decoded.length - 1);
      if (!closed && tail >= 0xd800 && tail <= 0xdbff) {
        decoded = decoded.slice(0, -1);
        position = lastStart;
      }
      return decoded;
    },
  };
}

// The preset's reply document. A reply is complete once it closes after its body.
export const DOCUMENT_END = '</recorder_output>';
const BODY_START = /<recorder_body>|<gametxt>/u;

/**
 * Per-response state that moves tool-call text into ordinary text fields and
 * tracks the visible reply, whether it came through the tool or as plain text.
 * One reply may arrive over several calls or rounds; texts are joined in
 * arrival order, with a line break kept where a call starts mid-line. A
 * document closed before any body is held back, because the body follows in
 * a continuation; flushHeld releases it if none comes.
 */
export function createReplyRestorer({ now = () => Date.now(), startedAt = now() } = {}) {
  // Arrivals count from the request, since a relay may hold back even the headers.
  const started = startedAt;
  const stats = { used: false, calls: 0, toolChunks: 0, toolChars: 0, plainChars: 0, received: 0, delivered: '', arrivals: [] };
  let callText = '';
  let held = '';
  let format = 'openai';

  // Splits off a trailing close tag (or its unfinished start) while no body has appeared.
  function splitHeld(text) {
    if (BODY_START.test(stats.delivered + text)) return [text, ''];
    const at = text.lastIndexOf('<');
    if (at < 0 || !DOCUMENT_END.startsWith(text.slice(at).trimEnd())) return [text, ''];
    let start = at;
    while (start > 0 && /\s/u.test(text[start - 1])) start -= 1;
    return [text.slice(0, start), text.slice(start)];
  }

  // More text after a complete held close means it was premature: drop the tag.
  function settleHeld(text) {
    if (held.trim() === DOCUMENT_END && /\S/u.test(text)) held = held.match(/^\s*/u)[0];
  }

  function take(text) {
    if (!text) return '';
    stats.received += text.length;
    settleHeld(text);
    const [emitted, rest] = splitHeld(held + text);
    held = rest;
    stats.delivered += emitted;
    return emitted;
  }

  const startCall = () => {
    stats.used = true;
    stats.calls += 1;
    callText = '';
  };

  const deliver = text => {
    if (!text) return '';
    // Calls are asked to split at line breaks; keep one where a join lands mid-line.
    settleHeld(text);
    const before = stats.delivered + held;
    if (!callText && before && !before.endsWith('\n') && !text.startsWith('\n')) text = '\n' + text;
    callText += text;
    stats.toolChunks += 1;
    stats.toolChars += text.length;
    if (stats.arrivals.length < 200) stats.arrivals.push(Math.round((now() - started) / 100) / 10);
    return take(text);
  };

  const plain = text => {
    stats.plainChars += text.length;
    return take(text);
  };

  // A Google partial call continues while willContinue is set, whatever its name.
  let googleOpen = false;
  function restoreGoogle(payload) {
    format = 'google';
    for (const candidate of payload.candidates) {
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) continue;
      const restored = [];
      for (const part of parts) {
        const call = part?.functionCall;
        const continuing = googleOpen && !!call;
        if (!call || (!continuing && call.name !== TOOL_OUTPUT_NAME)) {
          if (!call && typeof part?.text === 'string' && part.thought !== true) {
            const text = plain(part.text);
            if (text) restored.push({ ...part, text });
          } else restored.push(part);
          continue;
        }
        let text = '';
        if (Array.isArray(call.partialArgs)) {
          if (!continuing) startCall();
          for (const piece of call.partialArgs) {
            if (typeof piece?.stringValue === 'string' && String(piece.jsonPath ?? '').endsWith(TOOL_OUTPUT_PARAM)) text += piece.stringValue;
          }
          googleOpen = call.willContinue === true;
        } else {
          startCall();
          googleOpen = false;
          if (typeof call.args?.[TOOL_OUTPUT_PARAM] === 'string') text = call.args[TOOL_OUTPUT_PARAM];
        }
        text = deliver(text);
        if (text) restored.push({ text });
      }
      candidate.content.parts = restored;
    }
    return payload;
  }

  // OpenAI-style calls are keyed by their index; streamed fragments after the
  // first usually omit the name. A named fragment whose key already finished
  // starts the next call, which also covers relays that send no index.
  const openAiReaders = new Map();
  function restoreOpenAi(payload) {
    format = 'openai';
    for (const choice of payload.choices) {
      const holder = choice?.delta ?? choice?.message;
      if (!holder) continue;
      if (typeof holder.content === 'string') holder.content = plain(holder.content);
      if (Array.isArray(holder.tool_calls)) {
        let text = '';
        const others = [];
        holder.tool_calls.forEach((call, position) => {
          const name = call?.function?.name;
          const key = call?.index ?? (choice.message ? 'message:' + position : 'stream');
          let reader = openAiReaders.get(key);
          if (name === TOOL_OUTPUT_NAME && (!reader || reader.closed)) {
            startCall();
            reader = createArgumentReader();
            openAiReaders.set(key, reader);
          } else if (name && name !== TOOL_OUTPUT_NAME) {
            others.push(call);
            return;
          } else if (!reader) {
            others.push(call);
            return;
          }
          text += deliver(reader.push(String(call.function?.arguments ?? '')));
        });
        if (others.length) holder.tool_calls = others;
        else delete holder.tool_calls;
        if (text) holder.content = (typeof holder.content === 'string' ? holder.content : '') + text;
      }
      if (stats.used && choice.finish_reason === 'tool_calls') choice.finish_reason = 'stop';
    }
    return payload;
  }

  function restore(payload) {
    if (Array.isArray(payload)) return payload.map(restore);
    if (Array.isArray(payload?.candidates)) return restoreGoogle(payload);
    if (Array.isArray(payload?.choices)) return restoreOpenAi(payload);
    return payload;
  }

  /** Releases held text; returns it with a minimal payload in the reply's format. */
  function flushHeld() {
    const text = held;
    held = '';
    if (!text) return null;
    stats.delivered += text;
    return {
      text,
      payload: format === 'google'
        ? { candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] } }] }
        : { choices: [{ index: 0, delta: { content: text } }] },
    };
  }

  return { restore, flushHeld, stats };
}

// Responses handed to the host are built from the host page's own classes, so
// they stay usable even if this script's frame is reloaded mid-reply.
function hostClasses(host = globalThis) {
  const pick = name => host?.[name] ?? globalThis[name];
  return { Response: pick('Response'), Headers: pick('Headers'), ReadableStream: pick('ReadableStream'), TextDecoder: pick('TextDecoder'), TextEncoder: pick('TextEncoder') };
}

function rebuild(response, body, { Response, Headers }) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

// Each later round sends the reply so far back as plain assistant text, so no
// function-call history (and no provider signature) is needed, and asks for
// the rest. The round after the audit uses the tail's own continuation block;
// a body that was cut short is resumed with the built-in instruction.
export const MAX_ROUNDS = 3;
export const CONTINUE_INSTRUCTION = `Skip native reasoning. The document delivered so far is the assistant message above. Continue it now with one ${TOOL_OUTPUT_NAME} call whose ${TOOL_OUTPUT_PARAM} begins exactly where that text stops and runs through ${DOCUMENT_END}. Do not repeat earlier text. Write nothing outside the function call.`;

export function continuationInstruction(delivered, tailContinuation) {
  return tailContinuation && !BODY_START.test(delivered) ? tailContinuation : CONTINUE_INSTRUCTION;
}

export function continuationBody(body, delivered, instruction = CONTINUE_INSTRUCTION) {
  return { ...body, messages: [...body.messages, { role: 'assistant', content: delivered }, { role: 'user', content: instruction }] };
}

/** Why the reply ends after `round`, or null when another round should follow. */
function stopReason(stats, round, receivedBefore, maxRounds) {
  if (stats.delivered.includes(DOCUMENT_END)) return 'complete';
  if (stats.received <= receivedBefore) return 'empty';
  if (round >= maxRounds) return maxRounds === 1 ? 'single' : 'limit';
  return null;
}

/**
 * Relays one or more event-stream rounds to the host as a single stream. Each
 * round's restored lines pass through as they arrive; a round's own [DONE] is
 * held back so the host keeps reading until the last round ends.
 */
function relayEventStreams(first, { restorer, nextRound, onRoundError, onDone, classes, maxRounds }) {
  const { ReadableStream, TextDecoder, TextEncoder } = classes;
  const encoder = new TextEncoder();
  let reader = null;
  let cancelled = false;
  const restoreLine = line => {
    const data = /^data:[ ]?(.*)$/u.exec(line);
    if (!data) return line;
    try { return 'data: ' + JSON.stringify(restorer.restore(JSON.parse(data[1]))); }
    catch { return line; }
  };
  const body = new ReadableStream({
    async start(controller) {
      try {
        let response = first;
        let sawDone = false;
        for (let round = 1; ; round += 1) {
          const receivedBefore = restorer.stats.received;
          const decoder = new TextDecoder();
          let pending = '';
          const emit = lines => {
            const kept = [];
            for (const raw of lines) {
              const line = raw.replace(/\r$/u, '');
              if (/^data:[ ]?\[DONE\]\s*$/u.test(line)) { sawDone = true; continue; }
              kept.push(restoreLine(line));
            }
            if (kept.length) controller.enqueue(encoder.encode(kept.join('\n') + '\n'));
          };
          reader = response.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop();
            emit(lines);
          }
          pending += decoder.decode();
          if (pending) emit([pending]);
          reader = null;
          restorer.stats.rounds = round;
          const reason = cancelled ? 'cancelled' : stopReason(restorer.stats, round, receivedBefore, maxRounds);
          if (reason) { restorer.stats.stopReason = reason; break; }
          response = await nextRound(restorer.stats.delivered);
          if (!response.ok || !response.body) {
            restorer.stats.rounds = round + 1;
            restorer.stats.stopReason = 'error';
            onRoundError({ status: response.status, round: round + 1 });
            break;
          }
          // Keep events of the next round apart from the last line of this one.
          controller.enqueue(encoder.encode('\n'));
        }
        const rest = restorer.flushHeld();
        if (rest) controller.enqueue(encoder.encode('\ndata: ' + JSON.stringify(rest.payload) + '\n\n'));
        if (sawDone) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        onDone(restorer.stats);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader?.cancel(reason);
    },
  });
  return rebuild(first, body, classes);
}

function appendText(payload, text) {
  const target = Array.isArray(payload) ? payload.at(-1) : payload;
  const message = target?.choices?.[0]?.message;
  if (message) { message.content = (typeof message.content === 'string' ? message.content : '') + text; return; }
  const parts = target?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) parts.push({ text });
}

/** Restores one or more complete JSON rounds into the first round's body. */
async function relayJsonRounds(first, { restorer, nextRound, onRoundError, onDone, classes, maxRounds }) {
  const text = await first.text();
  let merged;
  try { merged = restorer.restore(JSON.parse(text)); }
  catch { return rebuild(first, text, classes); }
  let receivedBefore = 0;
  for (let round = 1; ; round += 1) {
    restorer.stats.rounds = round;
    const reason = stopReason(restorer.stats, round, receivedBefore, maxRounds);
    if (reason) { restorer.stats.stopReason = reason; break; }
    receivedBefore = restorer.stats.received;
    const deliveredBefore = restorer.stats.delivered.length;
    const response = await nextRound(restorer.stats.delivered);
    if (!response.ok) {
      restorer.stats.rounds = round + 1;
      restorer.stats.stopReason = 'error';
      onRoundError({ status: response.status, round: round + 1 });
      break;
    }
    try { restorer.restore(await response.json()); }
    catch { restorer.stats.stopReason = 'error'; break; }
    appendText(merged, restorer.stats.delivered.slice(deliveredBefore));
  }
  const rest = restorer.flushHeld();
  if (rest) appendText(merged, rest.text);
  onDone(restorer.stats);
  return rebuild(first, JSON.stringify(merged), classes);
}

// Gemini usually returns the whole function-call argument at once, so a long
// reply leaves the connection silent until it is complete; an endpoint or
// gateway may then give up (HTTP 524 behind Cloudflare). The status may arrive
// directly or inside the error text the host relays.
function noticeTimeout(response, onTimeout) {
  if (response.status === 524) { onTimeout({ status: 524 }); return; }
  response.clone().text().then(text => {
    if (/\b524\b/u.test(text)) onTimeout({ status: 524 });
  }).catch(() => {});
}

/**
 * Wraps the host page's fetch. Each assistant instance owns one wrapper; a
 * disposed wrapper that another script has wrapped again stays in the chain as
 * a pass-through. Repeated wrappers are harmless: the tool is added once and a
 * restored reply carries no tool call for an outer wrapper to restore again.
 */
export function installToolOutputTransport({ host = window.parent ?? window, onResult = () => {}, onTimeout = () => {}, onRoundError = () => {} } = {}) {
  const original = host.fetch;
  const classes = hostClasses(host);
  let active = true;
  async function toolOutputFetch(input, init) {
    // Request and URL objects may come from another frame, so read them by shape.
    const url = typeof input === 'string' ? input : input?.url ?? input?.href;
    if (!active || typeof init?.body !== 'string' || String(init.method ?? 'GET').toUpperCase() !== 'POST' || !GENERATE_PATH.test(String(url ?? ''))) {
      return original.call(this, input, init);
    }
    let prepared = null;
    try { prepared = prepareToolOutputRequest(JSON.parse(init.body)); } catch { prepared = null; }
    if (!prepared) return original.call(this, input, init);
    const startedAt = Date.now();
    const send = body => original.call(this, input, { ...init, body: JSON.stringify(body) });
    const response = await send(prepared.body);
    if (prepared.active && !response.ok) noticeTimeout(response, onTimeout);
    if (!prepared.active || !response.ok || !response.body) return response;
    const restorer = createReplyRestorer({ startedAt });
    const options = {
      restorer,
      classes,
      maxRounds: prepared.continuation ? MAX_ROUNDS : 1,
      nextRound: async delivered => {
        const next = await send(continuationBody(prepared.body, delivered, continuationInstruction(delivered, prepared.continuation)));
        if (!next.ok) noticeTimeout(next, onTimeout);
        return next;
      },
      onRoundError,
      onDone: stats => onResult({ ...stats, split: !!prepared.continuation, streamed: prepared.body.stream === true }),
    };
    const type = response.headers.get('content-type') ?? '';
    return prepared.body.stream === true && !type.includes('application/json')
      ? relayEventStreams(response, options)
      : relayJsonRounds(response, options);
  }
  host.fetch = toolOutputFetch;
  return {
    dispose() {
      if (!active) return;
      active = false;
      if (host.fetch === toolOutputFetch) host.fetch = original;
    },
  };
}
