import { promises as fs } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { STORE_DIR, atomicWriteJson, getWorkspaceDir } from './storage';
import { saveCanvas } from './service';
import {
  WORKSPACES_MANIFEST_FILENAME,
  listWorkspaces,
} from './workspaces';
import type { WelcomeContent } from './welcome-content-types';
import { WELCOME_CONTENT_ZH } from './welcome-content-zh';
import { WELCOME_CONTENT_EN } from './welcome-content-en';
import {
  WELCOME_TRANSFORM,
  buildWelcomeCanvas,
  type WelcomeNoteKey,
  type WelcomeNotePaths,
} from './welcome-nodes';

export const WELCOME_WORKSPACE_ID = 'default';
export const WELCOME_WORKSPACE_NAME = 'Pulse Canvas';

/** Language for the seeded welcome content. Matches the renderer's
 *  i18n language codes. Resolved once at seed time; the welcome content is
 *  persisted to disk and not re-translated if the user switches language
 *  afterwards (acceptable for one-time onboarding content). */
export type WelcomeLanguage = 'zh' | 'en';

const WELCOME_CONTENT: Record<WelcomeLanguage, WelcomeContent> = {
  zh: WELCOME_CONTENT_ZH,
  en: WELCOME_CONTENT_EN,
};

/**
 * Resolve the welcome content language. An explicit override wins; otherwise
 * we follow the OS locale via Electron's `app.getLocale()` — which matches the
 * renderer's first-run default (it derives the initial language from
 * `navigator.language`). English is the fallback when the locale can't be
 * read (e.g. unit tests without a live Electron app).
 */
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

export async function ensureWelcomeWorkspaceSeeded(
  root: string = STORE_DIR,
  language?: WelcomeLanguage,
): Promise<WelcomeWorkspaceSeedResult> {
  const existing = await listWorkspaces(root);
  if (existing.workspaces.length > 0) return { seeded: false };

  const content = WELCOME_CONTENT[resolveWelcomeLanguage(language)];
  const now = Date.now();
  const seededAt = new Date(now).toISOString();
  const workspaceDir = getWorkspaceDir(WELCOME_WORKSPACE_ID, root);
  const notesDir = join(workspaceDir, 'notes');
  await fs.mkdir(notesDir, { recursive: true });

  // Persist every seeded note as a real markdown file, exactly as if the
  // user had created it, then hand the resolved paths to the layout builder.
  const notePaths = {} as WelcomeNotePaths;
  for (const key of Object.keys(content.notes) as WelcomeNoteKey[]) {
    const note = content.notes[key];
    const filePath = join(notesDir, note.filename);
    await fs.writeFile(filePath, note.content, 'utf-8');
    notePaths[key] = filePath;
  }

  const { nodes, edges } = buildWelcomeCanvas(content, notePaths, now);

  await saveCanvas(
    WELCOME_WORKSPACE_ID,
    {
      nodes,
      edges,
      transform: WELCOME_TRANSFORM,
      savedAt: seededAt,
    },
    { root },
  );

  await writeWelcomeManifest(root, seededAt);

  return { seeded: true, workspaceId: WELCOME_WORKSPACE_ID };
}
