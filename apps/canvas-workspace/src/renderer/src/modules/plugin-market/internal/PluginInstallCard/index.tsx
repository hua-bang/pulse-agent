import { useEffect, useState } from 'react';
import type { CanvasPluginInstallReport } from '../../../../../../shared/plugin-market';
import { getRegisteredNavItems } from '../../../../../../plugins/renderer';
import { Button } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { requestOpenPluginPage } from '../../../../shared/appShell';
import { findInstalledListing } from '../installedPluginActions';
import { resolveApi, syncRendererPlugins } from '../usePluginMarket';
import './index.css';

const MAX_DIAGNOSTICS = 3;

type EnableState = 'idle' | 'enabling' | 'enabled' | 'failed';

/** Parses a `canvas_plugin_install` tool result; null when it is not one. */
const parsePluginInstallReport = (result: string | undefined): CanvasPluginInstallReport | null => {
  if (!result) return null;
  try {
    const value = JSON.parse(result) as Partial<CanvasPluginInstallReport>;
    if (typeof value.ok !== 'boolean' || typeof value.root !== 'string') return null;
    return { diagnostics: [], hasNativeCode: false, nativeEnabled: false, nextStep: '', ...value } as CanvasPluginInstallReport;
  } catch {
    return null;
  }
};

const pluginNavItem = (pluginId: string | undefined) => (
  pluginId ? getRegisteredNavItems().find((item) => item.pluginId === pluginId) : undefined
);

/**
 * In-chat result of the agent's `canvas_plugin_install` tool. It is the
 * trust gate for agent-written plugins: only the user's click here turns
 * native code on, then the card opens the plugin page.
 */
const PluginInstallCard = ({ report }: { report: CanvasPluginInstallReport }) => {
  const { t } = useI18n();
  const [state, setState] = useState<EnableState>(report.nativeEnabled ? 'enabled' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const name = report.name ?? report.root;

  // The report is a snapshot from install time; the user may have enabled
  // or uninstalled the plugin since.
  useEffect(() => {
    if (!report.ok || !report.name) return;
    let cancelled = false;
    void findInstalledListing(report.name).then((listing) => {
      if (!cancelled && listing?.nativeEnabled) setState('enabled');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [report.ok, report.name]);

  const enableAndOpen = async () => {
    const api = resolveApi();
    if (!api || !report.listingId) return;
    setState('enabling');
    setError(null);
    const result = await api.setNativeEnabled(report.listingId, true).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (!result.ok) {
      setState('failed');
      setError(result.error ?? null);
      return;
    }
    await syncRendererPlugins().catch(() => undefined);
    setState('enabled');
    const path = pluginNavItem(report.name)?.path;
    if (path) requestOpenPluginPage(path);
  };

  // Read at render time: enabling re-renders the card after the plugin registers its entry.
  const navItem = state === 'enabled' ? pluginNavItem(report.name) : undefined;

  // Only parts a user acts on. A page shows up as the sidebar entry once enabled.
  const contents = report.contents;
  const chips = contents ? [
    contents.nodeTypes.length > 0 && t('pluginInstallCard.nodes', { count: contents.nodeTypes.length }),
    contents.skills.length > 0 && t('pluginInstallCard.skills', { count: contents.skills.length }),
    contents.mcpServers.length > 0 && t('pluginInstallCard.mcp', { count: contents.mcpServers.length }),
  ].filter((chip): chip is string => Boolean(chip)) : [];
  const problems = report.diagnostics;
  const canEnable = report.ok && report.hasNativeCode && Boolean(report.listingId);

  return (
    <article className="plugin-install-card" data-ok={report.ok}>
      <header className="plugin-install-card__header">
        <span className="plugin-install-card__status">
          {t(report.ok ? 'pluginInstallCard.installed' : 'pluginInstallCard.failed')}
        </span>
        <span className="plugin-install-card__name">
          {name}{report.version ? ` · v${report.version}` : ''}
        </span>
      </header>
      {report.description && <p className="plugin-install-card__description">{report.description}</p>}
      {chips.length > 0 && (
        <ul className="plugin-install-card__chips">
          {chips.map((chip) => <li key={chip}>{chip}</li>)}
        </ul>
      )}
      {(report.error || problems.length > 0) && (
        <ul className="plugin-install-card__diagnostics">
          {report.error && <li data-severity="error">{report.error}</li>}
          {problems.slice(0, MAX_DIAGNOSTICS).map((item, index) => (
            <li key={`${item.code}-${index}`} data-severity={item.severity}>{item.message}</li>
          ))}
          {problems.length > MAX_DIAGNOSTICS && (
            <li>{t('pluginInstallCard.moreDiagnostics', { count: problems.length - MAX_DIAGNOSTICS })}</li>
          )}
        </ul>
      )}
      {canEnable && (
        <footer className="plugin-install-card__footer">
          {state === 'enabled' ? (
            <>
              <span className="plugin-install-card__note">
                {navItem ? t('pluginInstallCard.inSidebar', { label: navItem.label }) : t('pluginInstallCard.enabled')}
              </span>
              {navItem && (
                <Button size="sm" onClick={() => requestOpenPluginPage(navItem.path)}>{t('pluginInstallCard.open')}</Button>
              )}
            </>
          ) : (
            <>
              <span className="plugin-install-card__note">
                {state === 'failed'
                  ? `${t('pluginInstallCard.enableFailed')}${error ? `: ${error}` : ''}`
                  : t('pluginInstallCard.trustNote')}
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={state === 'enabling'}
                onClick={() => void enableAndOpen()}
              >
                {t(state === 'enabling' ? 'pluginInstallCard.enabling' : 'pluginInstallCard.enableAndOpen')}
              </Button>
            </>
          )}
        </footer>
      )}
    </article>
  );
};

/** Renders a raw `canvas_plugin_install` tool result as the install card. */
export const PluginInstallResult = ({ result }: { result: string }) => {
  const report = parsePluginInstallReport(result);
  return report ? <PluginInstallCard report={report} /> : null;
};
