import { useEffect, useMemo, useState } from 'react';
import { useI18n, type I18nKey } from '../../i18n';
import { SpinnerIcon } from '../icons';
import { Button } from '../ui';
import type { ToolCallStatus } from './types';
import { displayToolStatus, formatToolDescription, formatToolLabel } from './ChatToolCalls';

type Translate = (key: I18nKey, params?: Record<string, string | number>) => string;

const activeTool = (tools: ToolCallStatus[]): ToolCallStatus | undefined => (
  [...tools].reverse().find(tool => tool.status === 'running')
  ?? [...tools].reverse().find(tool => tool.status === 'queued')
);

const formatElapsed = (elapsedMs: number, language: 'en' | 'zh'): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return language === 'zh' ? `${totalSeconds} 秒` : `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return language === 'zh'
    ? `${minutes} 分 ${seconds} 秒`
    : `${minutes}m ${seconds}s`;
};

interface ActivitySnapshot {
  label: string;
  startedAt?: number;
}

export const describeChatActivity = (
  tools: ToolCallStatus[],
  t: Translate,
): ActivitySnapshot => {
  const current = activeTool(tools);
  if (current) {
    const label = formatToolDescription(current) ?? (current.status === 'queued'
      ? t('chat.activity.queued')
      : formatToolLabel(current.name, current.status, t));
    return {
      label,
      startedAt: current.startedAt,
    };
  }

  if (tools.length > 0) {
    const latest = tools[tools.length - 1]!;
    const status = displayToolStatus(latest);
    return {
      label: formatToolDescription(latest) ?? formatToolLabel(latest.name, status, t),
      startedAt: latest.startedAt,
    };
  }

  return {
    label: t('chat.activity.preparing'),
  };
};

interface Props {
  tools: ToolCallStatus[];
  startedAt?: number;
  detailsExpanded?: boolean;
  onToggleDetails?: () => void;
}

export const ChatActivityStatus = ({ tools, startedAt, detailsExpanded = false, onToggleDetails }: Props) => {
  const { language, t } = useI18n();
  const activity = useMemo(() => describeChatActivity(tools, t), [t, tools]);
  const [now, setNow] = useState(() => Date.now());
  const effectiveStartedAt = startedAt ?? activity.startedAt;

  useEffect(() => {
    setNow(Date.now());
    if (effectiveStartedAt === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [effectiveStartedAt]);

  const elapsedMs = effectiveStartedAt === undefined ? null : Math.max(0, now - effectiveStartedAt);
  const label = detailsExpanded || tools.length === 0 ? t('chat.activity.working') : activity.label;
  const elapsedLabel = elapsedMs === null ? null : formatElapsed(elapsedMs, language);

  return (
    <div className="chat-activity-status" role="status" aria-label={elapsedLabel ? `${label}, ${elapsedLabel}` : label}>
      <div className="chat-activity-status__tool-row">
        <SpinnerIcon size={12} className="chat-activity-status__spinner" />
        <span className="chat-activity-status__label" title={label}>{label}</span>
        {elapsedLabel && <span className="chat-activity-status__elapsed" aria-hidden="true">{elapsedLabel}</span>}
        {tools.length > 0 && onToggleDetails && (
          <Button
            variant="icon"
            size="xs"
            className="chat-activity-status__details"
            aria-expanded={detailsExpanded}
            aria-label={t(detailsExpanded ? 'chat.toolCalls.collapseSection' : 'chat.toolCalls.expandSection', { count: tools.length })}
            onClick={onToggleDetails}
          >
            <svg className={detailsExpanded ? 'chat-activity-status__chevron chat-activity-status__chevron--open' : 'chat-activity-status__chevron'} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  );
};
