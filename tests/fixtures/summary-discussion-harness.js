// Bundled by tests/flavors.test.js under each flavor; the summary material pass
// must keep discussion floors out of the material it sends.
import { processMessagesByTags } from '../../src/summary/messages.js';

const discussion = { destined_discussion: { version: 1, mode: 'discussion' } };
const messages = [
  { id: 0, role: 'assistant', name: 'AI', message: '<gametxt>开局剧情</gametxt>', extra: {} },
  { id: 1, role: 'assistant', name: 'AI', message: '<discussion_record>场外讨论</discussion_record>', extra: discussion },
  { id: 2, role: 'user', name: 'User', message: '继续', extra: {} },
  { id: 3, role: 'assistant', name: 'AI', message: '<discussion_record>又一轮讨论</discussion_record>', extra: { extra: discussion } },
];

globalThis.__summaryReport = JSON.stringify(processMessagesByTags(messages, ['gametxt'], [], true));
