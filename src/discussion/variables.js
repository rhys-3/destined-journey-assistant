import { hasDiscussionWrapper } from './protocol.js';

/** MVU passes the original floor content, including any late extra-model append. */
export function suppressDiscussionCommands(_variables, commands, messageContent, pendingDiscussionSource = false) {
  if (Array.isArray(commands) && (pendingDiscussionSource || hasDiscussionWrapper(messageContent))) commands.length = 0;
}
