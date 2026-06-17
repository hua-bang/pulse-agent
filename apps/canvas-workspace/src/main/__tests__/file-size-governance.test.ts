import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative, sep } from 'path';

const WARN_LINE_THRESHOLD = 400;
const HARD_LINE_THRESHOLD = 500;
const SOURCE_ROOT = 'src';
const GOVERNED_EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

const CURRENT_OVER_500_BASELINE: Record<string, number> = {
  'src/renderer/src/components/AgentTeamFrame/index.css': 2950,
  'src/renderer/src/components/chat/ChatPanel.css': 2945,
  'src/main/agent-teams/service.ts': 2569,
  'src/renderer/src/components/AgentTeamFrame/index.tsx': 2229,
  'src/renderer/src/types.ts': 1861,
  'src/main/canvas/store.ts': 1606,
  'src/renderer/src/components/AgentNodeBody/index.css': 1393,
  'src/renderer/src/components/AgentNodeBody/useAgentNodeController.ts': 1286,
  'src/main/agent/canvas-agent.ts': 1158,
  'src/main/canvas/storage.ts': 1122,
  'src/renderer/src/components/CanvasNodeView/index.css': 1130,
  'src/renderer/src/components/ReferenceDrawer/index.css': 1049,
  'src/renderer/src/components/WorkspaceNodes/index.css': 1026,
  'src/renderer/src/components/Sidebar/index.css': 939,
  'src/renderer/src/hooks/useNodes.ts': 918,
  'src/main/agent/context-builder.ts': 856,
  'src/renderer/src/components/WorkspaceNodes/GraphPage.tsx': 812,
  'src/renderer/src/components/settings-config/McpManager.tsx': 786,
  'src/renderer/src/components/Canvas/index.tsx': 770,
  'src/plugins/main/channel/channels/feishu/feishu-channel.ts': 762,
  'src/main/agent-teams/canvas-nodes.ts': 739,
  'src/main/runtime/control-server.ts': 685,
  'src/main/runtime/mcp-server.ts': 652,
  'src/renderer/src/components/settings-config/settings-config.css': 614,
  'src/renderer/src/App.tsx': 606,
  'src/renderer/src/utils/mindmapLayout.ts': 603,
  'src/main/agent/model/config.ts': 599,
  'src/plugins/main/dynamic-app/tools.ts': 593,
  'src/main/settings/canvas-plugins-config.ts': 558,
  'src/main/agent/session-store.ts': 557,
  'src/renderer/src/components/artifacts/artifacts.css': 577,
  'src/renderer/src/components/chat/hooks/useChatStream.ts': 542,
  'src/main/agent/service.ts': 520,
  'src/main/webview/registry.ts': 512,
  'src/renderer/src/hooks/useFileNodeEditor.ts': 511,
  'src/main/agent/skills/config.ts': 511,
  'src/renderer/src/components/icons/index.tsx': 510,
  'src/renderer/src/components/settings-config/SkillsManager.tsx': 510,
  'src/plugins/main/webview-page-control/js-primitives.ts': 506,
  'src/renderer/src/components/Workbench/index.tsx': 505,
};

const DOCUMENTED_EXCEPTIONS: Record<string, string> = {
  'src/renderer/src/i18n/messages.ts': 'Locale message catalog: data-like copy table governed by i18n review, not file-size refactors.',
};

interface ScannedFile {
  path: string;
  lineCount: number;
}

interface WarningMetadata extends ScannedFile {
  threshold: typeof WARN_LINE_THRESHOLD;
  recordedBaseline?: number;
}

function toRepoPath(path: string): string {
  return path.split(sep).join('/');
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.endsWith('\n')
    ? normalized.split('\n').length - 1
    : normalized.split('\n').length;
}

function isGeneratedOrDataPath(path: string): boolean {
  return path.includes('/__generated__/')
    || path.includes('/generated/')
    || path.includes('.generated.')
    || path.includes('.gen.');
}

function isProductionSourceFile(path: string): boolean {
  if (!GOVERNED_EXTENSIONS.has(extname(path))) {
    return false;
  }

  if (path.endsWith('.d.ts')) {
    return false;
  }

  if (path.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/.test(path)) {
    return false;
  }

  if (isGeneratedOrDataPath(path) || DOCUMENTED_EXCEPTIONS[path]) {
    return false;
  }

  return true;
}

function collectFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const absolutePath = join(dir, entry);
      const stats = statSync(absolutePath);
      return stats.isDirectory() ? collectFiles(absolutePath) : [absolutePath];
    });
}

function scanProductionFiles(): ScannedFile[] {
  return collectFiles(join(process.cwd(), SOURCE_ROOT))
    .map((absolutePath) => toRepoPath(relative(process.cwd(), absolutePath)))
    .filter(isProductionSourceFile)
    .map((path) => ({
      path,
      lineCount: countLines(readFileSync(join(process.cwd(), path), 'utf8')),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function buildWarningMetadata(files: ScannedFile[]): WarningMetadata[] {
  return files
    .filter((file) => file.lineCount > WARN_LINE_THRESHOLD)
    .map((file) => ({
      ...file,
      threshold: WARN_LINE_THRESHOLD,
      recordedBaseline: CURRENT_OVER_500_BASELINE[file.path],
    }));
}

function buildHardThresholdViolations(files: ScannedFile[]): string[] {
  return files.flatMap((file) => {
    if (file.lineCount <= HARD_LINE_THRESHOLD) {
      return [];
    }

    const baseline = CURRENT_OVER_500_BASELINE[file.path];
    if (baseline === undefined) {
      return [`${file.path} has ${file.lineCount} lines and is not in the ${HARD_LINE_THRESHOLD}-line baseline`];
    }

    if (file.lineCount > baseline) {
      return [`${file.path} grew from baseline ${baseline} to ${file.lineCount} lines`];
    }

    return [];
  });
}

describe('file size governance', () => {
  it('records over-400 production files as warning metadata only', () => {
    const warnings = buildWarningMetadata(scanProductionFiles());

    for (const warning of warnings) {
      expect(warning.lineCount).toBeGreaterThan(WARN_LINE_THRESHOLD);
      expect(warning.threshold).toBe(WARN_LINE_THRESHOLD);
    }
  });

  it('blocks new or growing production files over 500 lines', () => {
    const violations = buildHardThresholdViolations(scanProductionFiles());

    expect(violations).toEqual([]);
  });
});
