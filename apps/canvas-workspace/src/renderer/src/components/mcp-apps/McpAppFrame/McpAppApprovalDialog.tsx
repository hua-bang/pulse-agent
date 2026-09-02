import { useEffect, useRef } from 'react';
import { CaretRight, ShieldCheck } from '@phosphor-icons/react';
import type {
  McpAppToolApprovalDecision,
  McpAppToolApprovalRequest,
} from '../../../../../shared/mcp-apps';
import { useI18n } from '../../../i18n';
import { Button, Modal } from '../../ui';

interface McpAppApprovalDialogProps {
  request?: McpAppToolApprovalRequest;
  onDecision: (decision: McpAppToolApprovalDecision) => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${Math.ceil(bytes / 1_024)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
};

export const McpAppApprovalDialog = ({ request, onDecision }: McpAppApprovalDialogProps) => {
  const { t } = useI18n();
  const allowOnceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request) allowOnceRef.current?.focus();
  }, [request]);

  return (
    <Modal
      open={Boolean(request)}
      onClose={() => onDecision('cancel')}
      width={560}
      labelledBy="mcp-app-approval-title"
      className="mcp-app-approval"
    >
      {request && <>
        <header className="mcp-app-approval__header">
          <div className="mcp-app-approval__icon" aria-hidden="true">
            <ShieldCheck size={20} weight="duotone" />
          </div>
          <div>
            <div className="mcp-app-approval__eyebrow">{t('mcpApp.approval.eyebrow')}</div>
            <h2 id="mcp-app-approval-title">{t('mcpApp.approval.title')}</h2>
          </div>
        </header>
        <div className="mcp-app-approval__body">
          <p>{t('mcpApp.approval.summary', { server: request.serverName })}</p>
          <div className="mcp-app-approval__tool">
            <span>{t('mcpApp.approval.tool')}</span>
            <code>{request.toolName}</code>
          </div>
          <details className="mcp-app-approval__details">
            <summary>
              <CaretRight size={13} aria-hidden="true" />
              <span>{t('mcpApp.approval.details')}</span>
              <small>{formatBytes(request.argumentsSize)}</small>
            </summary>
            <pre>{request.argumentsPreview}</pre>
            {request.truncated && (
              <div className="mcp-app-approval__truncated">{t('mcpApp.approval.truncated')}</div>
            )}
          </details>
        </div>
        <footer className="mcp-app-approval__footer">
          <Button size="md" onClick={() => onDecision('cancel')}>
            {t('mcpApp.approval.cancel')}
          </Button>
          <div className="mcp-app-approval__allow-actions">
            <Button size="md" onClick={() => onDecision('session')}>
              {t('mcpApp.approval.session')}
            </Button>
            <Button
              ref={allowOnceRef}
              variant="primary"
              size="md"
              onClick={() => onDecision('once')}
            >
              {t('mcpApp.approval.once')}
            </Button>
          </div>
        </footer>
      </>}
    </Modal>
  );
};
