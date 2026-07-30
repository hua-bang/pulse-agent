/** Whether the dock's pinned Pulse AI tab exists for a given app view.
 *
 * A full-page chat owns the whole surface and renders its own chat body, so
 * the dock hides its chat tab there (`chatTabEnabled`). Anything that wants to
 * SHOW a conversation must ask here first: on those views the dock cannot
 * display it and routing is the only way. Keeping one predicate means the
 * prop and its callers can never drift apart — a caller that assumed the dock
 * was available would silently swallow the open (no tab, no navigation). */
export const isDockChatTabEnabled = (activeView: string): boolean =>
  activeView !== 'chat' && activeView !== 'scheduled-task';
