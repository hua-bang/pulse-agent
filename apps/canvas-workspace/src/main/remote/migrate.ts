import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { PulseStorage } from '@pulse-coder/storage';
import { createRemoteWorkspaceFiles, openRemoteStorage } from '@pulse-coder/storage/remote';
import { resolveRemoteTargetFromConfig } from './client';
import { saveRemoteWorkspaceConfig, type RemoteVpsWorkspaceConfig } from './config';

export interface MigrateWorkspaceToVpsOptions {
  workspaceId: string;
  config: RemoteVpsWorkspaceConfig;
  localStorage: PulseStorage;
  /** Optional local workspace directory whose Markdown notes and attachments will be uploaded. */
  localWorkspaceDir?: string;
  /** Optional custom store directory for saving `remote-workspaces.json`. */
  storeDir?: string;
  /** Skip importing if the remote workspace already has canvas nodes or local workspace has nothing to migrate. */
  onlyIfRemoteEmpty?: boolean;
}

export interface MigrateWorkspaceToVpsResult {
  migrated: boolean;
  remoteWorkspaceId: string;
  canvasRevision: number;
  conversationCount: number;
  uploadedFiles: number;
}

const SKIPPED_NAMES = new Set(['.DS_Store', '__locks__', '__storage-backup__']);

async function collectFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIPPED_NAMES.has(entry.name)) continue;
    const full = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Migrate an existing local workspace (canvas structure, conversations, notes,
 * and attachments) to a remote VPS daemon, then bind it in `remote-workspaces.json`.
 * Local data is never deleted and stays intact as a backup.
 */
export async function migrateLocalWorkspaceToVps(
  options: MigrateWorkspaceToVpsOptions,
): Promise<MigrateWorkspaceToVpsResult> {
  const bundle = await options.localStorage.workspaces.readBundle(options.workspaceId);
  const localFiles = options.localWorkspaceDir ? await collectFiles(options.localWorkspaceDir) : [];

  if (options.onlyIfRemoteEmpty) {
    const hasLocalData =
      Boolean(bundle && (bundle.canvas.nodes.length > 0 || bundle.conversations.length > 0)) ||
      localFiles.length > 0;
    if (!hasLocalData || !bundle) {
      const targetId = options.config.remoteWorkspaceId?.trim() || options.workspaceId;
      saveRemoteWorkspaceConfig(
        options.workspaceId,
        {
          ...options.config,
          remoteWorkspaceId: targetId,
          storage: options.config.storage ?? 'vps',
          runtime: options.config.runtime ?? 'vps',
        },
        options.storeDir,
      );
      return {
        migrated: false,
        remoteWorkspaceId: targetId,
        canvasRevision: 0,
        conversationCount: 0,
        uploadedFiles: 0,
      };
    }
  } else if (!bundle) {
    throw new Error(`Local workspace "${options.workspaceId}" was not found in local storage.`);
  }

  const target = await resolveRemoteTargetFromConfig(options.workspaceId, options.config);
  const remoteStorage = await openRemoteStorage({ endpoint: target.endpoint, token: target.token });
  const remoteFiles = createRemoteWorkspaceFiles({
    endpoint: target.endpoint,
    token: target.token,
  });

  try {
    if (options.onlyIfRemoteEmpty) {
      const existingRemote = await remoteStorage.canvas.read(target.remoteWorkspaceId);
      if (existingRemote && existingRemote.nodes.length > 0) {
        saveRemoteWorkspaceConfig(
          options.workspaceId,
          {
            ...options.config,
            remoteWorkspaceId: target.remoteWorkspaceId,
            storage: options.config.storage ?? 'vps',
            runtime: options.config.runtime ?? 'vps',
          },
          options.storeDir,
        );
        return {
          migrated: false,
          remoteWorkspaceId: target.remoteWorkspaceId,
          canvasRevision: existingRemote.revision,
          conversationCount: 0,
          uploadedFiles: 0,
        };
      }
    }

    let uploadedFiles = 0;
    if (options.localWorkspaceDir) {
      for (const filePath of localFiles) {
        const relPosix = relative(options.localWorkspaceDir, filePath).split(sep).join('/');
        const remoteUri = remoteFiles.uriForPath(`${target.remoteWorkspaceId}/${relPosix}`);
        const bytes = await readFile(filePath);
        await remoteFiles.write(remoteUri, bytes);
        uploadedFiles += 1;
      }
    }

    const receipt = await remoteStorage.workspaces.importBundle({
      canvas: {
        workspaceId: target.remoteWorkspaceId,
        metadata: bundle!.canvas.metadata,
        nodes: bundle!.canvas.nodes,
        placements: bundle!.canvas.placements,
        edges: bundle!.canvas.edges,
      },
      currentSessionId: bundle!.conversationScope?.currentSessionId ?? null,
      conversations: bundle!.conversations.map((conv) => ({
        sessionId: conv.sessionId,
        metadata: conv.metadata,
        messages: conv.messages,
      })),
    });

    saveRemoteWorkspaceConfig(
      options.workspaceId,
      {
        ...options.config,
        remoteWorkspaceId: target.remoteWorkspaceId,
        storage: options.config.storage ?? 'vps',
        runtime: options.config.runtime ?? 'vps',
      },
      options.storeDir,
    );

    return {
      migrated: true,
      remoteWorkspaceId: target.remoteWorkspaceId,
      canvasRevision: receipt.revision,
      conversationCount: bundle!.conversations.length,
      uploadedFiles,
    };
  } finally {
    await remoteStorage.close();
  }
}
