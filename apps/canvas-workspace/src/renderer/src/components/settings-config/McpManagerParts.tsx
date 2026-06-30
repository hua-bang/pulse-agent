import type { CanvasMcpServerHealth } from '../../types';

interface HealthBadgeProps {
  health: CanvasMcpServerHealth | undefined;
  t: (key: any, params?: any) => string;
}

export const HealthBadge = ({ health, t }: HealthBadgeProps) => {
  if (!health) {
    return <span className="cfg-health cfg-health--unknown">{t('mcpConfig.healthUnknown')}</span>;
  }
  if (health.ok) {
    const total = health.tools?.length ?? health.toolCount;
    const label =
      health.tools && total !== health.toolCount
        ? t('mcpConfig.healthOkPartial', { enabled: health.toolCount, total })
        : t('mcpConfig.healthOk', { count: health.toolCount });
    return <span className="cfg-health cfg-health--ok">✓ {label}</span>;
  }
  return (
    <span className="cfg-health cfg-health--err" title={health.error}>
      ⚠ {health.error.length > 40 ? `${health.error.slice(0, 40)}…` : health.error}
    </span>
  );
};

interface ToolsListProps {
  health: CanvasMcpServerHealth | undefined;
  readOnly?: boolean;
  isBusy?: (toolName: string) => boolean;
  onToggle?: (toolName: string, enabled: boolean) => void;
  t: (key: any, params?: any) => string;
}

export const ToolsList = ({ health, readOnly, isBusy, onToggle, t }: ToolsListProps) => {
  if (!health || !health.ok || !health.tools) {
    return <div className="cfg-tools-empty">{t('mcpConfig.toolsUnavailable')}</div>;
  }
  if (health.tools.length === 0) {
    return <div className="cfg-tools-empty">{t('mcpConfig.toolsNone')}</div>;
  }
  return (
    <ul className="cfg-tools-list">
      {health.tools.map((tool) => (
        <li key={tool.name} className={`cfg-tool${tool.enabled ? '' : ' cfg-tool--off'}`}>
          <label className="cfg-tool-toggle">
            <input
              type="checkbox"
              checked={tool.enabled}
              disabled={readOnly || isBusy?.(tool.name)}
              onChange={(e) => onToggle?.(tool.name, e.target.checked)}
            />
            <span className="cfg-tool-name">{tool.name}</span>
          </label>
          {tool.description && (
            <span className="cfg-tool-desc" title={tool.description}>
              {tool.description}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
};
