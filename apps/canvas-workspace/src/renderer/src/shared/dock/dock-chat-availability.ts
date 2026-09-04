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

/** Whether a canvas tab may offer a user-editing mode in this host surface.
 * This is deliberately narrower than "no dock chat tab": scheduled-task also
 * owns a full-page conversation, but only the dedicated AI Chat page is an
 * editing host. Keep the capability route-derived and fail-closed. */
export const isCanvasTabEditingAllowed = (activeView: string): boolean =>
  activeView === 'chat';

/** Whether the route-level Pulse launcher (the floating logo button) renders.
 *
 * Canvas owns its own bottom chrome and toggles chat from the floating
 * toolbar, so the launcher stays out of its way there. Every other route has
 * no chat affordance of its own — the launcher IS the way in, which is why it
 * derives from `isDockChatTabEnabled` instead of an ad-hoc route list: a
 * launcher on a view whose dock has no chat tab would toggle a surface that
 * cannot render, and a missing launcher (what the Scheduled list used to have)
 * leaves the route with no way to reach the agent at all. */
export const isGlobalChatLauncherVisible = (activeView: string): boolean =>
  activeView !== 'canvas' && isDockChatTabEnabled(activeView);
