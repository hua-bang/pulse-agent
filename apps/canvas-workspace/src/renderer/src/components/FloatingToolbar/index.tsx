import './index.css';
import { ShapeToolButton } from './ShapeToolButton';
import { PulseGlyphIcon } from '../icons';
import { useI18n, type I18nKey } from '../../i18n';

interface Props {
  activeTool: string;
  onToolChange: (tool: string) => void;
  onAddNode: (type: "file" | "terminal" | "frame" | "group" | "agent" | "text" | "iframe" | "mindmap") => void;
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
              <PulseGlyphIcon size={18} />
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
          title={t('canvas.toolbar.addText')}
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
          title={t('canvas.toolbar.addNote')}
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
          title={t('canvas.toolbar.addFrame')}
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
          title={t('canvas.toolbar.addWeb')}
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
          onClick={() => onAddNode("agent")}
          title={t('canvas.toolbar.addCodingAgent')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M6.5 5L3 9l3.5 4M11.5 5L15 9l-3.5 4M9.8 4.5l-1.6 9"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="toolbar-btn-label">{t('canvas.toolbar.coding')}</span>
        </button>
        {onCreateAgentTeam && (
          <button
            className="toolbar-btn toolbar-btn--create"
            onClick={onCreateAgentTeam}
            title={t('canvas.toolbar.addAgentTeam')}
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
        <button
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode("mindmap")}
          title={t('canvas.toolbar.addMindmap')}
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
      </div>
    </div>
  );
};
