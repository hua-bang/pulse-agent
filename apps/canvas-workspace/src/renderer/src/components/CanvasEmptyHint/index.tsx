import { useState, type FormEvent } from 'react';
import type { CanvasNode } from '../../types';
import { AppLogoIcon } from '../icons';
import { NodeTypeBadge } from '../CanvasNodeView/NodeTypeBadge';
import { useI18n } from '../../i18n';
import { normalizeReferenceUrl } from '../ReferenceDrawer/utils';
import './index.css';

interface CanvasEmptyHintProps {
  onCreateNode: (type: Extract<CanvasNode['type'], 'agent' | 'terminal' | 'file' | 'iframe'>) => void;
  onCreateUrl?: (url: string) => void;
  onCreateDemo?: () => void;
  onConfigureAi?: () => void;
  onOpenChat?: () => void;
  onOpenShortcuts: () => void;
  onSetRootFolder?: () => void;
}

export const CanvasEmptyHint = ({
  onCreateNode,
  onCreateUrl,
  onCreateDemo,
  onConfigureAi,
  onOpenChat,
  onOpenShortcuts,
  onSetRootFolder,
}: CanvasEmptyHintProps) => {
  const { t } = useI18n();
  const [urlComposerOpen, setUrlComposerOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState('');

  const openUrlComposer = () => {
    if (!onCreateUrl) {
      onCreateNode('iframe');
      return;
    }
    setUrlComposerOpen(true);
    setUrlError('');
    void navigator.clipboard?.readText?.().then((text) => {
      const normalized = normalizeReferenceUrl(text);
      if (!normalized) return;
      setUrlDraft((current) => (current.trim() ? current : normalized));
    }).catch(() => {
      // Clipboard access can be denied; the input still works manually.
    });
  };

  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onCreateUrl) return;
    const normalized = normalizeReferenceUrl(urlDraft);
    if (!normalized) {
      setUrlError(t('canvas.empty.urlInvalid'));
      return;
    }
    onCreateUrl(normalized);
    setUrlComposerOpen(false);
    setUrlDraft('');
    setUrlError('');
  };

  const primaryActions = [
    {
      key: 'set-root',
      icon: <NodeTypeBadge type="file" />,
      kicker: t('canvas.empty.recommended'),
      label: t('canvas.empty.setProjectFolder'),
      description: t('canvas.empty.setProjectFolderDescription'),
      onClick: onSetRootFolder,
    },
    {
      key: 'demo',
      icon: <AppLogoIcon size={16} />,
      kicker: t('canvas.empty.preview'),
      label: t('canvas.empty.demoCanvas'),
      description: t('canvas.empty.demoCanvasDescription'),
      onClick: onCreateDemo,
    },
  ].filter((action) => Boolean(action.onClick));

  const captureActions = [
    {
      key: 'note',
      icon: <NodeTypeBadge type="file" />,
      label: t('canvas.empty.newNote'),
      description: t('canvas.empty.newNoteDescription'),
      onClick: () => onCreateNode('file'),
    },
    {
      key: 'web',
      icon: <NodeTypeBadge type="iframe" />,
      label: t('canvas.empty.webPage'),
      description: t('canvas.empty.webPageDescription'),
      onClick: openUrlComposer,
    },
  ];

  const executionActions = [
    {
      key: 'ai',
      icon: <AppLogoIcon size={16} />,
      label: t('canvas.empty.openAiChat'),
      description: t('canvas.empty.openAiChatDescription'),
      onClick: onOpenChat ?? onConfigureAi,
    },
    {
      key: 'agent',
      icon: <NodeTypeBadge type="agent" />,
      label: t('canvas.empty.createAgent'),
      description: t('canvas.empty.createAgentDescription'),
      onClick: () => onCreateNode('agent'),
    },
  ].filter((action) => Boolean(action.onClick));

  return (
    <div className="canvas-empty-hint">
      <div className="canvas-empty-card">
        <div className="hint-icon">
          <AppLogoIcon size={34} />
        </div>
        <div className="hint-text">{t('canvas.empty.title')}</div>
        <div className="hint-sub">{t('canvas.empty.description')}</div>
        {primaryActions.length > 0 && (
          <div className="canvas-empty-primary">
            {primaryActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className="canvas-empty-action canvas-empty-action--primary"
                onClick={action.onClick}
              >
                <span className="canvas-empty-action__icon">{action.icon}</span>
                <span className="canvas-empty-action__copy">
                  <span className="canvas-empty-action__meta">{action.kicker}</span>
                  <span className="canvas-empty-action__label">{action.label}</span>
                  <span className="canvas-empty-action__description">{action.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="canvas-empty-section">
          <div className="canvas-empty-section__title">{t('canvas.empty.captureSection')}</div>
          <div className="canvas-empty-actions">
            {captureActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className="canvas-empty-action"
                onClick={action.onClick}
              >
                <span className="canvas-empty-action__icon">{action.icon}</span>
                <span className="canvas-empty-action__copy">
                  <span className="canvas-empty-action__label">{action.label}</span>
                  <span className="canvas-empty-action__description">{action.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="canvas-empty-section">
          <div className="canvas-empty-section__title">{t('canvas.empty.executionSection')}</div>
          <div className="canvas-empty-actions">
            {executionActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className="canvas-empty-action"
                onClick={action.onClick}
              >
                <span className="canvas-empty-action__icon">{action.icon}</span>
                <span className="canvas-empty-action__copy">
                  <span className="canvas-empty-action__label">{action.label}</span>
                  <span className="canvas-empty-action__description">{action.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        {urlComposerOpen && (
          <form className="canvas-empty-url-form" onSubmit={submitUrl}>
            <input
              type="text"
              inputMode="url"
              autoComplete="url"
              className="canvas-empty-url-input"
              value={urlDraft}
              onChange={(event) => {
                setUrlDraft(event.target.value);
                setUrlError('');
              }}
              placeholder={t('canvas.empty.urlPlaceholder')}
              autoFocus
              spellCheck={false}
            />
            <button type="submit" className="canvas-empty-url-submit">
              {t('canvas.empty.urlAdd')}
            </button>
            <button
              type="button"
              className="canvas-empty-url-cancel"
              onClick={() => {
                setUrlComposerOpen(false);
                setUrlError('');
              }}
            >
              {t('canvas.empty.urlCancel')}
            </button>
            {urlError && <div className="canvas-empty-url-error">{urlError}</div>}
          </form>
        )}
        <button type="button" className="canvas-empty-shortcuts" onClick={onOpenShortcuts}>
          <span className="canvas-empty-shortcuts__key">?</span>
          <span>{t('canvas.empty.showShortcuts')}</span>
        </button>
      </div>
    </div>
  );
};
