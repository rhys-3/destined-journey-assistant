import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/summary/config.js';
import { configureRuntime, invalidate, setRuntimeEnabled } from '../src/platform/lifecycle.js';
import { buildSummaryPromptParams } from '../src/summary/prompt.js';
import { computeSummaryPlans } from '../src/summary/summary.js';
import { consecutiveSummaries } from '../src/summary/provenance.js';

let messages, script, chat;
function reset() {
  messages = []; script = {}; chat = {};
  globalThis.SillyTavern = { getContext: () => ({ chatId: 'discussion-test', characterId: 1 }), name1: 'User', name2: 'Character' };
  globalThis.getLoadedPresetName = () => '命定';
  globalThis.getVariables = options => structuredClone(options?.type === 'chat' ? chat : script);
  globalThis.replaceVariables = (value, options) => { if (options?.type === 'chat') chat = structuredClone(value); else script = structuredClone(value); };
  globalThis.getLastMessageId = () => messages.at(-1)?.message_id ?? -1;
  globalThis.getChatMessages = range => {
    const [start, end = start] = String(range).split('-').map(Number);
    return structuredClone(messages.filter(message => message.message_id >= start && message.message_id <= end));
  };
  globalThis.getWorldbookNames = async () => [];
  globalThis.getGlobalWorldbookNames = () => [];
  configureRuntime({ status() {} }); invalidate(); setRuntimeEnabled(false);
}
test.beforeEach(reset);

const discussion = (message_id, role, message) => ({
  message_id, role, message,
  extra: { destined_discussion: { version: 1, mode: 'discussion' } },
});
const story = (message_id, role, message) => ({ message_id, role, message, extra: {} });

test('discussion floors are absent from summary material, scan text, and sources', async () => {
  messages = [
    story(0, 'user', '剧情提问'), story(1, 'assistant', '<gametxt>剧情回答</gametxt>'),
    discussion(2, 'user', '<destined_discussion>幕后问题</destined_discussion>'),
    discussion(3, 'assistant', '<destined_discussion>幕后建议</destined_discussion>'),
    story(4, 'user', '继续剧情'), story(5, 'assistant', '<gametxt>继续回答</gametxt>'),
  ];
  const params = await buildSummaryPromptParams(0, 5, { ...DEFAULT_SETTINGS, includeOldSummary: false });
  assert.match(params.mergedChatText, /剧情回答/);
  assert.match(params.mergedChatText, /继续回答/);
  assert.doesNotMatch(params.mergedChatText, /幕后问题|幕后建议/);
  assert.doesNotMatch(params.scanText, /幕后问题|幕后建议/);
  assert.deepEqual(params.sources.map(source => source.id), [0, 1, 4, 5]);
});

test('automatic planning keeps story-floor semantics and bridges only discussion gaps', async () => {
  messages = [
    story(0, 'user', 'a'), story(1, 'assistant', '<gametxt>a</gametxt>'),
    discussion(2, 'user', 'ooc'), discussion(3, 'assistant', 'ooc'),
    story(4, 'user', 'b'), story(5, 'assistant', '<gametxt>b</gametxt>'),
    story(6, 'user', 'keep'), story(7, 'assistant', '<gametxt>keep</gametxt>'),
  ];
  const settings = { ...DEFAULT_SETTINGS, keepFloorCount: 2, batchFloorCount: 10 };
  const plans = await computeSummaryPlans(settings);
  assert.deepEqual(plans.map(({ startFloor, endFloor, entryName }) => ({ startFloor, endFloor, entryName })), [
    { startFloor: 0, endFloor: 5, entryName: '总结0-5楼' },
  ]);
  assert.equal(plans[0].unsummarizedCount, 6);
  assert.doesNotThrow(() => consecutiveSummaries(['总结0-1楼', '总结4-5楼'], { discussionIds: new Set([2, 3]) }));
  assert.throws(() => consecutiveSummaries(['总结0-1楼', '总结4-5楼'], { discussionIds: new Set([2]) }), /连续/);
  assert.throws(() => consecutiveSummaries(['总结0-5楼', '总结4-7楼'], { discussionIds: new Set([2, 3]) }), /连续/);
});
