import {
  Code,
  FolderOpen,
  GitBranch,
  LockKey,
  PlugsConnected,
  ShieldWarning,
  Sparkle,
  X,
} from '@phosphor-icons/react';
import type { PluginMarketListing } from '../../../../../shared/plugin-market';
import { Button, Modal } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { PluginGlyph } from './PluginGlyph';
import { pluginMarketKeys as keys } from './i18nKeys';

interface Props {
  listing: PluginMarketListing | null;
  busyKey: string | null;
  error: string | null;
  onClose: () => void;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onConnectMcp: (id: string) => void;
  onSetNativeEnabled: (id: string, enabled: boolean) => void;
  onExplore: (listing: PluginMarketListing) => void;
  scopeTarget: HTMLElement | null;
}

const sourceText = (listing: PluginMarketListing): string => {
  if (listing.source.kind === 'directory') return listing.source.path ?? '';
  const suffix = listing.source.ref ? `#${listing.source.ref}` : '';
  const subdir = listing.source.subdir ? ` / ${listing.source.subdir}` : '';
  return `${listing.source.url ?? ''}${suffix}${subdir}`;
};

export const PluginDetailModal = ({
  listing,
  busyKey,
  error,
  onClose,
  onInstall,
  onUninstall,
  onConnectMcp,
  onSetNativeEnabled,
  onExplore,
  scopeTarget,
}: Props) => {
  const { t } = useI18n();
  if (!listing) return null;
  const installing = busyKey === `install:${listing.id}`;
  const uninstalling = busyKey === `uninstall:${listing.id}`;
  const connecting = busyKey === `connect:${listing.id}`;
  const changingNative = busyKey === `native:${listing.id}`;
  const exploring = busyKey === `explore:${listing.id}`;

  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      labelledBy="plugin-market-detail-title"
      className="plugin-market-modal plugin-market-detail"
      scopeTarget={scopeTarget}
    >
        <header className="plugin-market-modal__header">
          <div className="plugin-market-detail__identity">
            <PluginGlyph listing={listing} size={26} />
            <div>
              <small>{t(keys.detailsKicker)}</small>
              <h2 id="plugin-market-detail-title">{listing.name}</h2>
              <span>
                {[listing.version, listing.author?.name, listing.category].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <Button variant="icon" size="md" aria-label={t(keys.close)} onClick={onClose}>
            <X size={17} />
          </Button>
        </header>
        <div className="plugin-market-modal__body plugin-market-detail__body">
          <p className="plugin-market-detail__description">{listing.description}</p>
          {listing.license && (
            <div className="plugin-market-detail__metadata">
              <span>{t(keys.license)}</span>
              <code>{listing.license}</code>
            </div>
          )}

        <section className="plugin-market-detail__section">
          <h3>{t(keys.capabilities)}</h3>
          <div className="plugin-market-detail__capabilities">
            {listing.capabilities.skillCount > 0 && (
              <span><Sparkle size={15} />{t(keys.skillsCount, { count: listing.capabilities.skillCount })}</span>
            )}
            {listing.capabilities.mcpServerCount > 0 && (
              <span><PlugsConnected size={15} />{t(keys.mcpServersCount, { count: listing.capabilities.mcpServerCount })}</span>
            )}
            {listing.capabilities.hasPulseExtension && (
              <span><Code size={15} />{t(keys.pulseExtension)}</span>
            )}
            {listing.capabilities.skillCount === 0
              && listing.capabilities.mcpServerCount === 0
              && !listing.capabilities.hasPulseExtension
              && <span>{t(keys.noCapabilities)}</span>}
          </div>
          {listing.mcpAuthState && (
            <div className="plugin-market-detail__connection" data-state={listing.mcpAuthState}>
              <PlugsConnected size={15} />
              {listing.mcpAuthState === 'connected' ? t(keys.connected) : t(keys.connectionRequired)}
            </div>
          )}
        </section>

        <section className="plugin-market-detail__section">
          <h3>{t(keys.source)}</h3>
          <div className="plugin-market-detail__source">
            {listing.source.kind === 'git' ? <GitBranch size={17} /> : <FolderOpen size={17} />}
            <span>
              <small>{listing.source.kind === 'git' ? t(keys.sourceGit) : t(keys.sourceDirectory)}</small>
              <code>{sourceText(listing)}</code>
            </span>
          </div>
        </section>

        {listing.installState === 'installed' && listing.capabilities.hasPulseExtension && (
          <section className="plugin-market-detail__native">
            <ShieldWarning size={20} />
            <span>
              <strong>{t(keys.nativeTitle)}</strong>
              <small>{t(keys.nativeDescription)}</small>
            </span>
            <Button
              size="sm"
              disabled={changingNative}
              onClick={() => onSetNativeEnabled(listing.id, !listing.nativeEnabled)}
            >
              <LockKey size={14} />
              {listing.nativeEnabled ? t(keys.disableNative) : t(keys.enableNative)}
            </Button>
          </section>
        )}

        {(listing.error || error) && (
          <div className="plugin-market-modal__error" role="alert">{listing.error ?? error}</div>
        )}
        </div>
        <footer className="plugin-market-modal__actions">
          <Button onClick={onClose}>{t(keys.close)}</Button>
          {listing.installState === 'available' && (
            <Button variant="primary" disabled={installing} onClick={() => onInstall(listing.id)}>
              {installing ? t(keys.installing) : t(keys.install)}
            </Button>
          )}
          {listing.installState === 'installed' && (
            <>
              {listing.mcpAuthState === 'connectable' && (
                <Button
                  variant="primary"
                  disabled={connecting}
                  onClick={() => onConnectMcp(listing.id)}
                >
                  {connecting ? t(keys.connecting) : t(keys.connect)}
                </Button>
              )}
              <Button variant="danger" disabled={uninstalling} onClick={() => onUninstall(listing.id)}>
                {uninstalling ? t(keys.uninstalling) : t(keys.uninstall)}
              </Button>
            </>
          )}
          {listing.installState === 'unsupported' && (
            <Button disabled={exploring} onClick={() => onExplore(listing)}>
              {t(keys.explore)}
            </Button>
          )}
        </footer>
    </Modal>
  );
};
