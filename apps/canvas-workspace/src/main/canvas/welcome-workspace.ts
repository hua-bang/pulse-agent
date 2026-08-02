import { join } from 'path';
import { app } from 'electron';
import { STORE_DIR, atomicWriteJson, readCanvasFull } from './storage';
import { saveCanvas } from './service';
import {
  WORKSPACES_MANIFEST_FILENAME,
  listWorkspaces,
} from './workspaces';

export const WELCOME_WORKSPACE_ID = 'default';
export const WELCOME_WORKSPACE_NAME = 'Pulse Canvas';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';
const DOWNLOAD_MANIFEST_URL = `${DOWNLOAD_URL}latest.json`;
const WELCOME_DOWNLOAD_NODE_ID = 'node-welcome-download';

export type WelcomeLanguage = 'zh' | 'en';

const makeLocalDownloadUrl = (language: WelcomeLanguage): string => {
  const params = new URLSearchParams({ lang: language, manifest: DOWNLOAD_MANIFEST_URL });
  return `pulse-canvas://app/download-site/index.html?${params}`;
};

const resolveWelcomeLanguage = (explicit?: WelcomeLanguage): WelcomeLanguage => {
  if (explicit === 'zh' || explicit === 'en') return explicit;
  try {
    const locale = (app?.getLocale?.() ?? '').toLowerCase();
    if (locale.startsWith('zh')) return 'zh';
  } catch {
    // app unavailable (e.g. vitest) — fall through to default
  }
  return 'en';
};

export interface WelcomeWorkspaceSeedResult {
  seeded: boolean;
  workspaceId?: string;
}

const writeWelcomeManifest = async (root: string, seededAt: string): Promise<void> => {
  await atomicWriteJson(
    join(root, WORKSPACES_MANIFEST_FILENAME),
    JSON.stringify(
      {
        workspaces: [{ id: WELCOME_WORKSPACE_ID, name: WELCOME_WORKSPACE_NAME }],
        folders: [],
        activeId: WELCOME_WORKSPACE_ID,
        welcomeSeededAt: seededAt,
      },
      null,
      2,
    ),
  );
};

/**
 * Create a focused first-run workspace. New users start from the same empty
 * state as every later workspace, where the renderer can guide them through
 * connecting a project, writing a brief, and starting a coding agent.
 *
 * Existing welcome workspaces are left untouched. The one compatibility
 * migration below only upgrades the legacy remote download node to its local
 * card so older user data keeps working.
 */
export async function ensureWelcomeWorkspaceSeeded(
  root: string = STORE_DIR,
  language?: WelcomeLanguage,
): Promise<WelcomeWorkspaceSeedResult> {
  const existing = await listWorkspaces(root);
  if (existing.workspaces.length > 0) {
    if (existing.workspaces.some((workspace) => workspace.id === WELCOME_WORKSPACE_ID)) {
      const current = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
      const nodes = current.data?.nodes ?? [];
      const index = nodes.findIndex((node) => node.id === WELCOME_DOWNLOAD_NODE_ID);
      const node = index >= 0 ? nodes[index] : null;
      const data = node?.data as { mode?: string; url?: string; localUrl?: string; html?: string } | undefined;
      const isLegacyRemote = data?.mode === 'url' && data.url === DOWNLOAD_URL;
      const isGeneratedLocalCard = data?.mode === 'html'
        && !data.localUrl
        && data.html?.includes('pulse-canvas-download.pages.dev');
      if (node && (isLegacyRemote || isGeneratedLocalCard) && current.data) {
        const nextNodes = [...nodes];
        nextNodes[index] = {
          ...node,
          data: {
            ...node.data,
            mode: 'html',
            url: '',
            html: '',
            localUrl: makeLocalDownloadUrl(resolveWelcomeLanguage(language)),
          },
          updatedAt: Date.now(),
        };
        await saveCanvas(WELCOME_WORKSPACE_ID, { ...current.data, nodes: nextNodes }, { root });
      }
    }
    return { seeded: false };
  }

  const seededAt = new Date().toISOString();
  await saveCanvas(
    WELCOME_WORKSPACE_ID,
    {
      nodes: [],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: seededAt,
    },
    { root },
  );
  await writeWelcomeManifest(root, seededAt);

  return { seeded: true, workspaceId: WELCOME_WORKSPACE_ID };
}
