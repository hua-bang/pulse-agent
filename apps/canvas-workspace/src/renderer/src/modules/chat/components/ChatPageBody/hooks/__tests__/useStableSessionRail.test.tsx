// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStableSessionRail } from '../useStableSessionRail';
import { I18nProvider } from '../../../../../../i18n';
import type { AgentSessionInfo } from '../../../../../../types';
import type { AgentScope, OtherWorkspaceSession } from '../../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useStableSessionRail> | null = null;

const scope: AgentScope = { kind: 'workspace', workspaceId: 'workspace-a' };
const sessions: AgentSessionInfo[] = [
  { sessionId: 'session-a', date: '2026-08-22', messageCount: 1, isCurrent: false, preview: 'A' },
  { sessionId: 'session-b', date: '2026-08-22', messageCount: 1, isCurrent: false, preview: 'B' },
];

const Probe = ({
  otherSessions,
  selectedSessionKey,
  sessionRows,
  runningSessionIds,
}: {
  otherSessions?: OtherWorkspaceSession[];
  selectedSessionKey?: string | null;
  sessionRows?: AgentSessionInfo[];
  runningSessionIds?: ReadonlySet<string>;
}) => {
  latest = useStableSessionRail({
    agentScope: scope,
    allWorkspaces: [],
    currentScopeName: null,
    loading: false,
    otherSessions: otherSessions ?? [],
    selectedSessionKey: selectedSessionKey ?? null,
    sessions: sessionRows ?? sessions,
    sessionsStoreId: 'workspace-a',
    runningSessionIds,
  });
  return null;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  latest = null;
});

describe('useStableSessionRail running markers', () => {
  it('marks background-running sessions but NOT the session the user is viewing', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <Probe
            selectedSessionKey="workspace-a:session-a"
            runningSessionIds={new Set(['session-a', 'session-b'])}
          />
        </I18nProvider>,
      );
    });

    const byId = Object.fromEntries(latest!.map((entry) => [entry.sessionId, entry]));
    // session-a is what the user is viewing → no badge even though it runs.
    expect(byId['session-a']!.running).toBe(false);
    // session-b runs in the background → badge.
    expect(byId['session-b']!.running).toBe(true);
  });

  it('shows the badge for a running session when NO session is selected as current', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <Probe selectedSessionKey={null} runningSessionIds={new Set(['session-b'])} />
        </I18nProvider>,
      );
    });

    const byId = Object.fromEntries(latest!.map((entry) => [entry.sessionId, entry]));
    expect(byId['session-b']!.running).toBe(true);
  });

  it('deduplicates a session returned by both the current and cross-workspace lists', async () => {
    const duplicate: OtherWorkspaceSession = {
      sessionId: 'session-a',
      sourceWorkspaceId: 'workspace-a',
      workspaceName: 'Workspace A',
      date: '2026-08-22',
      messageCount: 1,
      preview: 'stale duplicate',
      isCurrent: false,
      pinned: false,
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <Probe
            otherSessions={[duplicate]}
            selectedSessionKey="workspace-a:session-a"
            sessionRows={[sessions[0]!]}
          />
        </I18nProvider>,
      );
    });

    expect(latest).toHaveLength(1);
    expect(latest![0]).toMatchObject({
      sessionId: 'session-a',
      workspaceId: 'workspace-a',
      preview: 'A',
      isCurrent: true,
    });
  });
});
