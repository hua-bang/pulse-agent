import { execFile } from "child_process";
import { ipcMain, dialog, BrowserWindow, clipboard, nativeImage, shell } from "electron";
import { promises as fs } from "fs";
import { join, basename, resolve, isAbsolute } from "path";
import { homedir } from "os";
import { promisify } from "util";
import { readTextFile, saveFilePreview, saveTextFile } from './file-save';
import type {
  FileCreateEntryRequest,
  FileRenameEntryRequest,
  FileSaveRequest,
  FileTrashEntryRequest,
  FileWriteRequest,
} from '../../shared/files';
import { createEntry, renameEntry, trashEntry } from './file-operations';
import { workspaceFiles } from './workspace-files';
import { readFilePreview } from './file-preview';
import { ensureImagePreview } from './image-preview';
import { deleteSavedImage, saveBase64Image } from './image-save';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', '.next', '.nuxt', '__pycache__', '.venv',
]);

interface DirEntry {
  name: string;
  type: 'file' | 'dir';
  children?: DirEntry[];
}

const listDirRecursive = async (
  dirPath: string,
  depth: number,
  maxDepth: number,
  includeHidden = false
): Promise<DirEntry[]> => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result: DirEntry[] = [];
  for (const entry of entries) {
    if (!includeHidden && (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name))) continue;
    if (entry.isDirectory()) {
      const item: DirEntry = { name: entry.name, type: 'dir' };
      if (depth < maxDepth) {
        try {
          item.children = await listDirRecursive(join(dirPath, entry.name), depth + 1, maxDepth, includeHidden);
        } catch {
          item.children = [];
        }
      }
      result.push(item);
    } else {
      result.push({ name: entry.name, type: 'file' });
    }
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
};

const STORE_DIR = join(homedir(), ".pulse-coder", "canvas");
const IMAGE_PREVIEW_DIR = join(STORE_DIR, 'image-previews');
const execFileAsync = promisify(execFile);

const getNotesDir = (workspaceId: string) =>
  join(STORE_DIR, workspaceId, "notes");

const formatError = (err: unknown): string => err instanceof Error ? err.message : String(err);

const vscodeUrlForPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  return `vscode://file/${encodeURI(normalized)}`;
};

export const setupFileManagerIpc = () => {
  const broadcastWrite = (filePath: string, content: string) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try { window.webContents.send('canvas:file-changed', { filePath, content }); }
      catch (error) { console.warn('[files] file change notification failed:', error); }
    }
  };
  // file:save-preview — compare version and atomically save an edited UTF-8 file.
  ipcMain.handle('file:save-preview', async (_event, request: FileSaveRequest) => {
    const result = await saveFilePreview(request);
    if (result.ok) broadcastWrite(request.filePath, request.content);
    return result;
  });
  // file:preview — bounded, regular-file-only UTF-8 preview for the Dock browser.
  ipcMain.handle('file:preview', (_event, payload: { filePath: string }) => readFilePreview(payload.filePath));
  // file:create-entry / file:rename-entry / file:trash-entry — root-confined Folder Dock mutations.
  ipcMain.handle('file:create-entry', (_event, request: FileCreateEntryRequest) => createEntry(request));
  ipcMain.handle('file:rename-entry', (_event, request: FileRenameEntryRequest) => renameEntry(request));
  ipcMain.handle('file:trash-entry', (_event, request: FileTrashEntryRequest) => trashEntry(request, path => shell.trashItem(path)));
  // Create a new note file in the workspace-scoped notes directory
  ipcMain.handle(
    "file:createNote",
    async (_event, payload: { workspaceId?: string; name?: string }) => {
      try {
        const wsId = payload.workspaceId ?? "default";
        const notesDir = getNotesDir(wsId);
        await fs.mkdir(notesDir, { recursive: true });
        const timestamp = Date.now();
        const safeName = payload.name
          ? payload.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim()
          : "";
        const fileName = safeName
          ? `${safeName}.md`
          : `note-${timestamp}.md`;
        const filePath = join(notesDir, fileName);
        await workspaceFiles.write(workspaceFiles.uriForPath(filePath), "");
        return { ok: true, filePath, fileName };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  // Read a file
  ipcMain.handle(
    "file:read",
    (_event, payload: { filePath: string }) => readTextFile(payload.filePath)
  );

  // Write a file
  ipcMain.handle(
    "file:write",
    async (_event, payload: FileWriteRequest) => {
      const result = await saveTextFile(payload);
      if (result.ok) broadcastWrite(payload.filePath, payload.content);
      return result;
    }
  );

  // List directory (recursive, max depth)
  ipcMain.handle(
    "file:listDir",
    async (_event, payload: { dirPath: string; maxDepth?: number; includeHidden?: boolean }) => {
      try {
        const entries = await listDirRecursive(payload.dirPath, 0, payload.maxDepth ?? 3, payload.includeHidden === true);
        return { ok: true, entries };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  // Open a project file/folder in VS Code. Prefer the CLI so folders and files
  // open in the current app window when supported; fall back to VS Code's URL scheme.
  ipcMain.handle(
    "file:openInVSCode",
    async (_event, payload: { filePath?: string }) => {
      const rawPath = payload.filePath?.trim();
      if (!rawPath) {
        return { ok: false, error: "Missing file path" };
      }

      const filePath = resolve(rawPath);
      try {
        await fs.access(filePath);
      } catch (err) {
        return { ok: false, filePath, error: `Path is not accessible: ${formatError(err)}` };
      }

      let lastError = "";
      for (const command of ["code", "code-insiders"]) {
        try {
          await execFileAsync(command, ["--reuse-window", filePath], { windowsHide: true });
          return { ok: true, filePath, command };
        } catch (err) {
          lastError = formatError(err);
        }
      }

      try {
        await shell.openExternal(vscodeUrlForPath(filePath));
        return { ok: true, filePath, command: "vscode-url" };
      } catch (err) {
        return { ok: false, filePath, error: formatError(err) || lastError || "Unable to open VS Code" };
      }
    }
  );

  // Open an explicit absolute local path with its system-default application.
  // The renderer only calls this after a user clicks a local Markdown link.
  ipcMain.handle(
    "file:openPath",
    async (_event, payload: { filePath?: string }) => {
      const rawPath = payload.filePath?.trim();
      if (!rawPath || !isAbsolute(rawPath)) {
        return { ok: false, error: "Expected an absolute file path" };
      }

      const filePath = resolve(rawPath);
      try {
        await fs.access(filePath);
      } catch (err) {
        return { ok: false, filePath, error: `Path is not accessible: ${formatError(err)}` };
      }

      const error = await shell.openPath(filePath);
      return error
        ? { ok: false, filePath, error }
        : { ok: true, filePath };
    }
  );

  // Open folder dialog
  ipcMain.handle("dialog:openFolder", async (_event) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: "Select Project Folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, folderPath: result.filePaths[0] };
  });

  // Open file dialog
  ipcMain.handle("file:openDialog", async (_event) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: "Open File",
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const filePath = result.filePaths[0];
    try {
      const file = await workspaceFiles.readText(workspaceFiles.uriForPath(filePath));
      if (!file) return { ok: false, error: `File not found: ${filePath}` };
      const { content } = file;
      const fileName = basename(filePath);
      return { ok: true, filePath, fileName, content };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Save an image (base64) to the workspace images directory
  ipcMain.handle(
    "file:saveImage",
    async (_event, payload: { workspaceId?: string; data: string; ext?: string }) => {
      try {
        const wsId = payload.workspaceId ?? "default";
        const { filePath, fileName } = await saveBase64Image({
          storeDir: STORE_DIR,
          workspaceId: wsId,
          data: payload.data,
          ext: payload.ext,
        });
        return { ok: true, filePath, fileName };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );
  ipcMain.handle(
    'file:delete-saved-image',
    async (_event, payload: { workspaceId?: string; filePath: string }) => {
      try {
        await deleteSavedImage({
          storeDir: STORE_DIR,
          workspaceId: payload.workspaceId ?? 'default',
          filePath: payload.filePath,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'file:getImagePreview',
    async (_event, payload: { filePath: string; maxDimension?: number }) => {
      try {
        if (!payload.filePath) return { ok: false, error: 'Missing image path' };
        const preview = await ensureImagePreview(payload.filePath, {
          cacheDir: IMAGE_PREVIEW_DIR,
          maxDimension: payload.maxDimension,
        });
        return { ok: true, preview };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // Export an image (base64) via save dialog
  ipcMain.handle(
    "file:exportImage",
    async (_event, payload: { defaultName?: string; data: string; ext?: string }) => {
      try {
        const ext = (payload.ext ?? "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
        const defaultName = payload.defaultName?.trim()
          ? payload.defaultName.trim()
          : `img-${Date.now()}.${ext}`;
        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showSaveDialog(win!, {
          title: "Export Image",
          defaultPath: defaultName,
          filters: [
            { name: "PNG Image", extensions: ["png"] },
            { name: "All Files", extensions: ["*"] }
          ]
        });
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }
        const buffer = Buffer.from(payload.data, "base64");
        await fs.writeFile(result.filePath, buffer);
        return { ok: true, filePath: result.filePath, fileName: basename(result.filePath) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  // Copy an image file to the system clipboard as image data.
  ipcMain.handle(
    "file:copyImage",
    async (_event, payload: { filePath: string }) => {
      try {
        if (!payload.filePath) {
          return { ok: false, error: "Missing image path" };
        }
        await fs.access(payload.filePath);
        const image = nativeImage.createFromPath(payload.filePath);
        if (image.isEmpty()) {
          return { ok: false, error: "Unsupported or unreadable image" };
        }
        clipboard.writeImage(image);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  // Save-as dialog
  ipcMain.handle(
    "file:saveAsDialog",
    async (_event, payload: { defaultName?: string; content: string }) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: "Save As",
        defaultPath: payload.defaultName || "untitled.md",
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      try {
        await fs.writeFile(result.filePath, payload.content, "utf-8");
        const fileName = basename(result.filePath);
        return { ok: true, filePath: result.filePath, fileName };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );
};
