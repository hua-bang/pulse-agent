import type { CanvasMcpAuth, CanvasMcpTransport } from '../../../../../../types';
import { Button, Select, TextField } from '../../../../../../components/ui';
import { setMcpDraftTransport, type McpServerDraft } from '../model';

interface Props {
  draft: McpServerDraft;
  saving: boolean;
  t: (key: any, params?: any) => string;
  onChange: (draft: McpServerDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const ServerForm = ({ draft, saving, t, onChange, onCancel, onSave }: Props) => {
  const isStdio = draft.transport === 'stdio';
  return (
    <div className="cfg-form">
      <TextField
        label={t('mcpConfig.name')}
        value={draft.name}
        placeholder={t('mcpConfig.namePlaceholder')}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />
      <div className="cfg-field">
        <span>{t('mcpConfig.transport')}</span>
        <Select
          ariaLabel={t('mcpConfig.transport')}
          value={draft.transport}
          options={[
            { value: 'http', label: 'http' },
            { value: 'sse', label: 'sse' },
            { value: 'stdio', label: 'stdio' },
          ]}
          onChange={(value) => onChange(setMcpDraftTransport(draft, value as CanvasMcpTransport))}
        />
      </div>

      {isStdio ? (
        <>
          <TextField
            label={t('mcpConfig.command')}
            value={draft.command}
            placeholder={t('mcpConfig.commandPlaceholder')}
            onChange={(event) => onChange({ ...draft, command: event.target.value })}
          />
          <TextField
            label={t('mcpConfig.args')}
            multiline
            className="cfg-textarea-mono"
            value={draft.argsText}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, argsText: event.target.value })}
          />
          <TextField
            label={t('mcpConfig.env')}
            multiline
            className="cfg-textarea-mono"
            value={draft.envText}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, envText: event.target.value })}
          />
          <TextField
            label={t('mcpConfig.cwd')}
            value={draft.cwd}
            onChange={(event) => onChange({ ...draft, cwd: event.target.value })}
          />
        </>
      ) : (
        <>
          <TextField
            label={t('mcpConfig.url')}
            value={draft.url}
            placeholder={t('mcpConfig.urlPlaceholder')}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
          />
          <TextField
            label={t('mcpConfig.headers')}
            multiline
            className="cfg-textarea-mono"
            value={draft.headersText}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, headersText: event.target.value })}
          />
          <div className="cfg-field">
            <span>{t('mcpConfig.auth')}</span>
            <Select
              ariaLabel={t('mcpConfig.auth')}
              value={draft.auth}
              options={[
                { value: 'none', label: t('mcpConfig.authNone') },
                { value: 'oauth', label: t('mcpConfig.authOAuth') },
              ]}
              onChange={(value) => onChange({ ...draft, auth: value as CanvasMcpAuth })}
            />
          </div>
          {draft.auth === 'oauth' && (
            <>
              <TextField
                label={t('mcpConfig.oauthClientId')}
                value={draft.oauthClientId}
                placeholder={t('mcpConfig.oauthClientIdPlaceholder')}
                onChange={(event) => onChange({ ...draft, oauthClientId: event.target.value })}
              />
              <TextField
                label={t('mcpConfig.oauthClientSecret')}
                type="password"
                value={draft.oauthClientSecret}
                placeholder={t('mcpConfig.oauthClientSecretPlaceholder')}
                onChange={(event) => onChange({ ...draft, oauthClientSecret: event.target.value })}
              />
              <TextField
                label={t('mcpConfig.oauthScope')}
                value={draft.oauthScope}
                placeholder={t('mcpConfig.oauthScopePlaceholder')}
                onChange={(event) => onChange({ ...draft, oauthScope: event.target.value })}
              />
              <div className="cfg-toolbar-hint" style={{ flex: 'none', marginTop: -2 }}>
                {t('mcpConfig.oauthHint')}
              </div>
            </>
          )}
        </>
      )}

      <label className="cfg-checkbox">
        <input
          type="checkbox"
          checked={draft.deferTools}
          onChange={(event) => onChange({ ...draft, deferTools: event.target.checked })}
        />
        <span>{t('mcpConfig.deferTools')}</span>
      </label>

      <div className="cfg-form-actions">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          {t('mcpConfig.cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
          {saving ? t('mcpConfig.saving') : t('mcpConfig.save')}
        </Button>
      </div>
    </div>
  );
};
