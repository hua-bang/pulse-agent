import type { ComponentType } from 'react';
export interface CanvasNode {
    id: string;
    type: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    data?: unknown;
}
export interface PluginNodeData {
    pluginId?: string;
    nodeType?: string;
    payload?: unknown;
}
export interface NotePayload {
    title?: string;
    body?: string;
    accent?: string;
    pinned?: boolean;
}
export interface PluginNodeViewProps {
    node: CanvasNode;
    workspaceId?: string;
    workspaceName?: string;
    readOnly?: boolean;
    selected?: boolean;
    updateNode(patch: Partial<CanvasNode>): void;
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
}
export interface RendererCtx {
    registerNodeView(nodeType: string, Component: ComponentType<PluginNodeViewProps>): void;
}
export interface RendererCanvasPlugin {
    id: string;
    activate(ctx: RendererCtx): void;
}
