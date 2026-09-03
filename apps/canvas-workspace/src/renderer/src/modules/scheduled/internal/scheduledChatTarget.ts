import { isDockChatTabEnabled } from '../../../shared/dock/dock-chat-availability';

export type ScheduledChatTarget =
  | { kind: 'dock' }
  | { kind: 'route'; path: string };

interface Options {
  /** Current app view (`App.tsx`'s `activeView`). */
  activeView: string;
  taskId: string;
  /** The AI Chat route, owned by the router host. */
  chatRoute: string;
}

/**
 * Where a scheduled task's conversation should be shown.
 *
 * The dock tab is the default: a run finishes while the user is on a canvas or
 * the Scheduled list, and yanking the whole app onto the AI Chat page loses
 * what they were looking at. It is also the same surface `Run now` already
 * opens, so both entry points land in one place.
 *
 * The route is the fallback ONLY where the dock has no chat tab (a full-page
 * chat already owns the surface) — there a dock open would be invisible.
 */
export const resolveScheduledChatTarget = ({ activeView, taskId, chatRoute }: Options): ScheduledChatTarget =>
  isDockChatTabEnabled(activeView)
    ? { kind: 'dock' }
    : { kind: 'route', path: `${chatRoute}?scheduledTask=${encodeURIComponent(taskId)}` };
