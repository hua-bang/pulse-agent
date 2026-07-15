import { join } from 'path';
import { homedir } from 'os';
import type { CreatableNodeType, KnownNodeType, NodeCapability } from './types';

export const DEFAULT_STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

export const NODE_CAPABILITIES: Record<KnownNodeType, NodeCapability[]> = {
  file: ['read', 'write'],
  terminal: ['read', 'exec'],
  frame: ['read', 'write'],
  group: ['read', 'write'],
  agent: ['read', 'exec'],
  mindmap: ['read', 'write'],
  // App-produced types. `text` is read+write (its markdown lives inline in
  // canvas.json, so the CLI can edit it); the rest are read-only — the CLI
  // surfaces their persisted metadata but does not create or mutate them.
  text: ['read', 'write'],
  iframe: ['read'],
  image: ['read'],
  shape: ['read'],
  reference: ['read'],
  'dynamic-app': ['read'],
  plugin: ['read'],
};

export const DEFAULT_NODE_DIMENSIONS: Record<CreatableNodeType, { title: string; width: number; height: number }> = {
  file: { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame: { title: 'Frame', width: 720, height: 600 },
  group: { title: 'Group', width: 360, height: 240 },
  agent: { title: 'Agent', width: 520, height: 380 },
  mindmap: { title: 'Mindmap', width: 640, height: 420 },
};

export const AGENTS_MD_TEMPLATE = `# Canvas Agent Config

## Purpose
<!-- Describe what this workspace is for -->

## Instructions
<!-- Conventions, style, or constraints for agents working in this workspace -->

---

<!-- canvas:auto-start -->
<!-- canvas:auto-end -->
`;
