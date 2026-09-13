/** Shared, non-secret protocol used by the preset, message UI and summary pipeline. */
export const DISCUSSION_VERSION = 1;
export const DISCUSSION_KEY = 'destined_discussion';
export const DISCUSSION_CHAT_KEY = 'destined_discussion_mode';
export const DISCUSSION_OPEN = '<discussion_record>';
export const DISCUSSION_CLOSE = '</discussion_record>';
export const LEGACY_DISCUSSION_OPEN = '<destined_discussion>';
export const LEGACY_DISCUSSION_CLOSE = '</destined_discussion>';
export const DISCUSSION_BRIDGE = '__destinedDiscussionV1';
export const DISCUSSION_CONTEXT_MARKERS = ['<|命定_资料开始|>', '<|命定_资料结束|>'];

function discussionBounds(text) {
  const value = String(text ?? '');
  const trimmed = value.trimStart();
  const pair = trimmed.startsWith(DISCUSSION_OPEN)
    ? [DISCUSSION_OPEN, DISCUSSION_CLOSE]
    : trimmed.startsWith(LEGACY_DISCUSSION_OPEN)
      ? [LEGACY_DISCUSSION_OPEN, LEGACY_DISCUSSION_CLOSE]
      : null;
  if (!pair) return null;
  const [open, close] = pair;
  const end = trimmed.lastIndexOf(close);
  if (end < open.length) return null;
  return { trimmed, open, close, end };
}

export function unwrapDiscussion(text) {
  const value = String(text ?? '');
  const bounds = discussionBounds(value);
  if (!bounds) return value;
  // MVU may append an extra-model result after the original closing tag.
  return [bounds.trimmed.slice(bounds.open.length, bounds.end).trim(), bounds.trimmed.slice(bounds.end + bounds.close.length).trim()].filter(Boolean).join('\n');
}

export function wrapDiscussion(text) {
  return `${DISCUSSION_OPEN}\n${unwrapDiscussion(text)}\n${DISCUSSION_CLOSE}`;
}

export function isDiscussionMessage(message) {
  // Helper snapshots can expose the native swipe record as extra; its metadata is nested.
  const metadata = getDiscussionMetadata(message);
  return metadata?.version === DISCUSSION_VERSION && metadata?.mode === 'discussion';
}

export function getDiscussionMetadata(message) {
  return message?.extra?.[DISCUSSION_KEY] ?? message?.extra?.extra?.[DISCUSSION_KEY] ?? null;
}

export function hasDiscussionWrapper(text) {
  return !!discussionBounds(text);
}
