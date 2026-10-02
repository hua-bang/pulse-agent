import { useI18n, type I18nKey } from '../../../../../i18n';
import type { ToolCallStatus } from '../../../../../types';
import {
  codemodeSource,
  groupCodemodeCalls,
  type CodemodeCallStatus,
  type CodemodeResultView,
} from './codemodeResult';

interface Props {
  tool: ToolCallStatus;
  view: CodemodeResultView;
}

const STATUS_KEYS: Record<CodemodeCallStatus, I18nKey> = {
  queued: 'chat.codemode.status.queued',
  running: 'chat.codemode.status.running',
  succeeded: 'chat.codemode.status.succeeded',
  intercepted: 'chat.codemode.status.intercepted',
  failed: 'chat.codemode.status.failed',
  cancelled: 'chat.codemode.status.cancelled',
};

const STATUS_ICONS: Record<CodemodeCallStatus, string> = {
  queued: '…',
  running: '…',
  succeeded: '✓',
  intercepted: '⊘',
  failed: '!',
  cancelled: '×',
};

const formatDuration = (ms: number | undefined): string | null => {
  if (ms === undefined) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const truncate = (text: string, max = 2000): string => (
  text.length > max ? `${text.slice(0, max)}\n…` : text
);

/** Folded script source first, then nested calls, output and errors. */
export const CodemodeToolSections = ({ tool, view }: Props) => {
  const { t } = useI18n();
  const source = codemodeSource(tool.args);
  const groups = groupCodemodeCalls(view.calls);
  const outputText = [
    ...view.output,
    ...(view.hasValue ? [formatValue(view.value)] : []),
  ].join('\n');

  return (
    <>
      {source && (
        <details className="chat-tool-call-section chat-codemode-script">
          <summary className="chat-tool-call-section-label">{t('chat.codemode.script')}</summary>
          <pre>{truncate(source)}</pre>
        </details>
      )}
      <div className="chat-tool-call-section">
        <div className="chat-tool-call-section-label">
          {t('chat.codemode.calls', { count: view.calls.length })}
        </div>
        {groups.length === 0 ? (
          <div className="chat-codemode-empty">{t('chat.codemode.noCalls')}</div>
        ) : (
          <ul className="chat-codemode-calls">
            {groups.map((group, index) => {
              const duration = formatDuration(group.durationMs);
              return (
                <li
                  key={`${group.name}:${index}`}
                  className={`chat-codemode-call chat-codemode-call--${group.status}`}
                >
                  <span className="chat-codemode-call-icon" aria-hidden="true">
                    {STATUS_ICONS[group.status]}
                  </span>
                  <span className="chat-codemode-call-name">{group.name}</span>
                  {group.count > 1 && <span className="chat-codemode-call-count">×{group.count}</span>}
                  <span className="chat-codemode-call-meta">
                    {group.status === 'succeeded' ? duration : t(STATUS_KEYS[group.status])}
                  </span>
                  {group.error && <span className="chat-codemode-call-error">{group.error}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {outputText && (
        <div className="chat-tool-call-section">
          <div className="chat-tool-call-section-label">{t('chat.toolCalls.output')}</div>
          <pre>{truncate(outputText)}</pre>
        </div>
      )}
      {view.error && (
        <div className="chat-tool-call-section chat-tool-call-section--error">
          <div className="chat-tool-call-section-label">{t('chat.toolCalls.error')}</div>
          <pre>{view.error}</pre>
        </div>
      )}
    </>
  );
};
