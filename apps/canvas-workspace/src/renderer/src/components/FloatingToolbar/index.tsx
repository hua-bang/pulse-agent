import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { ShapeToolButton } from './ShapeToolButton';
import { AppLogoIcon, CodingAgentIcon, PulseGlyphIcon } from '../icons';
import { useI18n, type I18nKey } from '../../i18n';
import {
  createTodoListPluginNodePatch,
  type CreatableCanvasNodeType,
} from '../../utils/nodeFactory';
import type { CanvasNode } from '../../types';
import type {
  CanvasPluginEntry,
  CanvasPluginManifestNode,
  CanvasPluginsStatus,
} from '../../types/settings-config';

interface AddNodeUiOptions {
  label?: string;
  nodePatch?: Partial<CanvasNode>;
}

interface Props {
  activeTool: string;
  onToolChange: (tool: string) => void;
  onAddNode: (type: CreatableCanvasNodeType, options?: AddNodeUiOptions) => void;
  onCreateAgentTeam?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
}

const tools: Array<{
  id: string;
  labelKey: I18nKey;
  icon: JSX.Element;
}> = [
  {
    id: "select",
    labelKey: 'canvas.toolbar.select',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M4 2l10 6.5L9 10l-1.5 6L4 2z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    id: "hand",
    labelKey: 'canvas.toolbar.pan',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 2v7M6 5v6.5a2.5 2.5 0 002.5 2.5h3A2.5 2.5 0 0014 11.5V8M6 5a1.5 1.5 0 013 0M12 5a1.5 1.5 0 00-3 0M12 5v3M14 8a1.5 1.5 0 00-3 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    id: "connect",
    labelKey: 'canvas.toolbar.connect',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="14" cy="14" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M5.5 5.5L12.5 12.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
];

interface PluginNodeOption {
  key: string;
  pluginId: string;
  nodeType: string;
  title: string;
  pluginLabel: string;
  version?: string;
  nodePatch?: Partial<CanvasNode>;
}

const DEFAULT_PLUGIN_WIDTH = 640;
const DEFAULT_PLUGIN_HEIGHT = 420;
const EXCALIDRAW_BOARD_WIDTH = 900;
const EXCALIDRAW_BOARD_HEIGHT = 640;

function pluginNodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="3" y="3.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 6.5h6M6 9h6M6 11.5h3.5" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      <path d="M12.5 11.2v2.6M11.2 12.5h2.6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

function manifestNodeTitle(node: CanvasPluginManifestNode): string {
  return typeof node.title === 'string' && node.title.trim() ? node.title.trim() : node.type;
}

function optionsFromPluginStatus(status: CanvasPluginsStatus | undefined): PluginNodeOption[] {
  if (!status) return [];
  const options: PluginNodeOption[] = [];
  for (const plugin of status.plugins) {
    if (plugin.error) continue;
    for (const node of plugin.nodes ?? []) {
      options.push(optionFromManifestNode(plugin, node));
    }
  }
  return options;
}

function optionFromManifestNode(
  plugin: CanvasPluginEntry,
  node: CanvasPluginManifestNode,
): PluginNodeOption {
  const title = manifestNodeTitle(node);
  const size = node.type === 'excalidraw.board'
    ? { width: EXCALIDRAW_BOARD_WIDTH, height: EXCALIDRAW_BOARD_HEIGHT }
    : { width: DEFAULT_PLUGIN_WIDTH, height: DEFAULT_PLUGIN_HEIGHT };
  return {
    key: `${plugin.id}:${node.type}`,
    pluginId: plugin.id,
    nodeType: node.type,
    title,
    pluginLabel: plugin.id,
    version: plugin.version,
    nodePatch: {
      title,
      width: size.width,
      height: size.height,
      data: {
        pluginId: plugin.id,
        nodeType: node.type,
        payload: {},
        version: plugin.version,
      },
    },
  };
}

export const FloatingToolbar = ({
  activeTool,
  onToolChange,
  onAddNode,
  onCreateAgentTeam,
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
}: Props) => {
  const { t } = useI18n();
  const pluginMenuRef = useRef<HTMLDivElement | null>(null);
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false);
  const [pluginStatus, setPluginStatus] = useState<CanvasPluginsStatus | undefined>();
  const [pluginLoading, setPluginLoading] = useState(false);

  const builtInPluginOptions = useMemo<PluginNodeOption[]>(() => [
    {
      key: 'builtin:mock.card',
      pluginId: 'mock',
      nodeType: 'mock.card',
      title: t('canvas.toolbar.pluginGeneric'),
      pluginLabel: t('canvas.toolbar.pluginBuiltIn'),
    },
    {
      key: 'builtin:mock.todo-list',
      pluginId: 'mock',
      nodeType: 'mock.todo-list',
      title: 'Todo List',
      pluginLabel: t('canvas.toolbar.pluginBuiltIn'),
      nodePatch: createTodoListPluginNodePatch(),
    },
  ], [t]);

  const externalPluginOptions = useMemo(
    () => optionsFromPluginStatus(pluginStatus),
    [pluginStatus],
  );
  const pluginOptions = useMemo(
    () => [...builtInPluginOptions, ...externalPluginOptions],
    [builtInPluginOptions, externalPluginOptions],
  );

  const loadPluginNodes = useCallback(async () => {
    const api = window.canvasWorkspace?.canvasPlugins;
    if (!api?.list) return;
    setPluginLoading(true);
    try {
      const res = await api.list();
      if (res.ok) setPluginStatus(res.status);
      else console.warn('[canvas-toolbar] failed to load plugins:', res.error);
    } catch (err) {
      console.warn('[canvas-toolbar] failed to load plugins:', err);
    } finally {
      setPluginLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pluginMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && pluginMenuRef.current?.contains(target)) return;
      setPluginMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPluginMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pluginMenuOpen]);

  const togglePluginMenu = useCallback(() => {
    setPluginMenuOpen((open) => {
      const next = !open;
      if (next) void loadPluginNodes();
      return next;
    });
  }, [loadPluginNodes]);

  const createPluginNode = useCallback((option: PluginNodeOption) => {
    setPluginMenuOpen(false);
    onAddNode('plugin', {
      label: option.title,
      nodePatch: option.nodePatch,
    });
  }, [onAddNode]);

  return (
    <div className="floating-toolbar">
      {onChatToggle && (
        <>
          <div className="toolbar-group">
            <button
              className={`toolbar-btn${chatPanelOpen ? " toolbar-btn--active" : ""}`}
              onClick={onChatToggle}
              title={t('canvas.toolbar.toggleChat')}
            >
              <AppLogoIcon size={18} />
            </button>
          </div>
          <div className="toolbar-divider" />
        </>
      )}

      {onReferenceToggle && (
        <>
          <div className="toolbar-group">
            <button
              className={`toolbar-btn${referenceDrawerOpen ? " toolbar-btn--active" : ""}`}
              onClick={onReferenceToggle}
              title={t('canvas.toolbar.toggleReference')}
              aria-label={t('canvas.toolbar.toggleReference')}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.6 6.2h4.8M6.6 8.7h3"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="toolbar-divider" />
        </>
      )}

      <div className="toolbar-group">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`toolbar-btn${activeTool === tool.id ? " toolbar-btn--active" : ""}`}
            onClick={() => onToolChange(tool.id)}
            title={t(tool.labelKey)}
          >
            {tool.icon}
          </button>
        ))}
        <ShapeToolButton activeTool={activeTool} onToolChange={onToolChange} />
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("text")}
          aria-label={t('canvas.toolbar.addText')}
          data-tooltip={t('canvas.toolbar.text')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M4 5h10M9 5v9M7 14h4"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
            />
          </svg>
          <span className="toolbar-btn-label">{t('canvas.toolbar.text')}</span>
        </button>
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("file")}
          aria-label={t('canvas.toolbar.addNote')}
          data-tooltip={t('canvas.toolbar.note')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect
              x="3" y="3" width="12" height="12" rx="2"
              stroke="currentColor" strokeWidth="1.3"
            />
            <path
              d="M7 9h4M9 7v4"
              stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
            />
          </svg>
          <span className="toolbar-btn-label">{t('canvas.toolbar.note')}</span>
        </button>
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("frame")}
          aria-label={t('canvas.toolbar.addFrame')}
          data-tooltip={t('canvas.toolbar.frame')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect
              x="2" y="2" width="14" height="14" rx="2.5"
              stroke="currentColor" strokeWidth="1.3"
            />
            <rect
              x="5" y="5" width="8" height="8" rx="1"
              stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5"
            />
          </svg>
          <span className="toolbar-btn-label">{t('canvas.toolbar.frame')}</span>
        </button>
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("iframe")}
          aria-label={t('canvas.toolbar.addWeb')}
          data-tooltip={t('canvas.toolbar.web')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M2.5 9h13M9 2.5c2.2 2.2 2.2 10.8 0 13M9 2.5c-2.2 2.2-2.2 10.8 0 13"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
            />
          </svg>
          <span className="toolbar-btn-label">{t('canvas.toolbar.web')}</span>
        </button>
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("mindmap")}
          aria-label={t('canvas.toolbar.addMindmap')}
          data-tooltip={t('canvas.toolbar.mindmap')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="4.5" cy="9" r="2" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="14" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="14" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="14" cy="13.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M6.5 8.2 L12.5 5 M6.5 9 L12.5 9 M6.5 9.8 L12.5 13"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
            />
          </svg>
          <span className="toolbar-btn-label">{t('canvas.toolbar.mindmap')}</span>
        </button>
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("agent")}
          aria-label={t('canvas.toolbar.addCodingAgent')}
          data-tooltip={t('canvas.toolbar.coding')}
        >
          <CodingAgentIcon size={18} />
          <span className="toolbar-btn-label">{t('canvas.toolbar.coding')}</span>
        </button>
        {onCreateAgentTeam && (
          <button
            className="toolbar-btn toolbar-btn--create"
            onClick={onCreateAgentTeam}
            aria-label={t('canvas.toolbar.addAgentTeam')}
            data-tooltip={t('canvas.toolbar.team')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2.5" y="3" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.25" />
              <path d="M5.5 6.5h7M5.5 9h7M5.5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="13" cy="12" r="2.3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.15" />
              <path d="M13 10.8v2.4M11.8 12h2.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
            <span className="toolbar-btn-label">{t('canvas.toolbar.team')}</span>
          </button>
        )}
        <div className="plugin-tool-menu" ref={pluginMenuRef}>
          <button
            className={`toolbar-btn toolbar-btn--create${pluginMenuOpen ? ' toolbar-btn--active' : ''}`}
            onClick={togglePluginMenu}
            aria-label={t('canvas.toolbar.addPluginNode')}
            aria-haspopup="menu"
            aria-expanded={pluginMenuOpen}
            data-tooltip={t('canvas.toolbar.plugin')}
          >
            {pluginNodeIcon()}
            <span className="toolbar-btn-label">{t('canvas.toolbar.plugin')}</span>
          </button>
          {pluginMenuOpen && (
            <div className="plugin-tool-popover" role="menu" aria-label={t('canvas.toolbar.plugin')}>
              {pluginOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="plugin-tool-option"
                  role="menuitem"
                  onClick={() => createPluginNode(option)}
                >
                  <span className="plugin-tool-option__icon">{pluginNodeIcon()}</span>
                  <span className="plugin-tool-option__copy">
                    <span className="plugin-tool-option__title">{option.title}</span>
                    <span className="plugin-tool-option__meta">
                      {option.pluginLabel} / {option.nodeType}
                    </span>
                  </span>
                </button>
              ))}
              {pluginLoading && (
                <div className="plugin-tool-empty">{t('canvas.toolbar.pluginLoading')}</div>
              )}
              {!pluginLoading && externalPluginOptions.length === 0 && (
                <div className="plugin-tool-empty">{t('canvas.toolbar.pluginOnlyBuiltIn')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
