import { DISCUSSION_KEY } from './protocol.js';

/** Keep native message.extra separate from swipe_info[i] (a record with its own extra). */
export function createDiscussionMessageAccess({ getContext, getMessages, setMessages }) {
  const read = id => {
    if (!Number.isInteger(id) || id < 0) return null;
    const raw = getContext()?.chat?.[id];
    if (!raw) return null;
    const basic = getMessages(id, { include_swipes: false })[0];
    if (!basic) return null;
    const swiped = getMessages(id, { include_swipes: true })[0];
    return { ...basic, ...swiped, message: raw.mes ?? '', extra: structuredClone(raw.extra ?? {}) };
  };
  const write = async update => {
    const raw = getContext()?.chat?.[update.message_id];
    const swipe = raw?.swipe_id ?? 0;
    if (!raw || (update.swipe_id !== undefined && update.swipe_id !== swipe)) throw new Error('回复页已变化，讨论标记未写入。');
    const content = update.message ?? update.swipes?.[swipe];
    const extra = update.extra ?? update.swipes_info?.[swipe];
    if (typeof content !== 'string' || !extra) throw new Error('讨论消息缺少正文或标记，已停止保存。');
    const apply = target => {
      if (extra[DISCUSSION_KEY]) target[DISCUSSION_KEY] = structuredClone(extra[DISCUSSION_KEY]);
      else delete target[DISCUSSION_KEY];
    };
    // Do not replace native extra objects: streaming handlers retain references to them.
    raw.extra ??= {};
    apply(raw.extra);
    const info = raw.swipe_info?.[swipe];
    if (info) {
      info.extra ??= structuredClone(raw.extra);
      apply(info.extra);
    }
    // The helper's swipes_info setter assigns a whole swipe record to native extra.
    // Only use its text setter; it synchronizes mes/swipes and schedules chat saving.
    await setMessages([{ message_id: update.message_id, message: content }], { refresh: 'none' });
  };
  return { read, write };
}
