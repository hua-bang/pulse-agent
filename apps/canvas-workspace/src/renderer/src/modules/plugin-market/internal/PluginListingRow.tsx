import {
  ArrowRight,
  DotsThree,
  WarningCircle,
} from '@phosphor-icons/react';
import type { PluginMarketListing } from '../../../../../shared/plugin-market';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { PluginGlyph } from './PluginGlyph';
import { pluginMarketKeys as keys } from './i18nKeys';

interface Props {
  listing: PluginMarketListing;
  busy: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onConnect: () => void;
  onExplore: () => void;
}

export const PluginListingRow = ({
  listing,
  busy,
  onOpen,
  onInstall,
  onConnect,
  onExplore,
}: Props) => {
  const { t } = useI18n();
  const needsConnect = listing.installState === 'installed' && listing.mcpAuthState === 'connectable';
  // An installed remote plugin is not usable until it connects, so the row
  // offers Connect instead of the details menu.
  const action = needsConnect ? (
    <Button
      size="xs"
      variant="primary"
      className="plugin-market__row-action"
      disabled={busy}
      title={t(keys.connectionRequired)}
      onClick={onConnect}
    >
      {busy ? t(keys.connecting) : t(keys.connect)}
    </Button>
  ) : listing.installState === 'available' ? (
    <Button
      size="xs"
      variant="primary"
      className="plugin-market__row-action"
      disabled={busy}
      onClick={onInstall}
    >
      {busy ? t(keys.installing) : t(keys.install)}
    </Button>
  ) : listing.installState === 'installed' ? (
    <Button
      variant="icon"
      size="xs"
      className="plugin-market__row-action plugin-market__row-more"
      aria-label={t(keys.openDetails, { name: listing.name })}
      onClick={onOpen}
    >
      <DotsThree size={17} weight="bold" />
    </Button>
  ) : (
    <Button
      size="xs"
      className="plugin-market__row-action"
      disabled={busy}
      onClick={onExplore}
    >
      {t(keys.explore)}
      <ArrowRight size={13} />
    </Button>
  );

  return (
    <article className="plugin-market__listing" data-plugin-id={listing.id}>
      <PluginGlyph listing={listing} size={22} />
      <Button
        className="plugin-market__listing-main"
        aria-label={t(keys.openDetails, { name: listing.name })}
        onClick={onOpen}
      >
        <span className="plugin-market__listing-title">
          <strong>{listing.name}</strong>
          {listing.error && (
            <span
              className="plugin-market__listing-warning"
              title={t(keys.listingError)}
              aria-label={t(keys.listingError)}
            >
              <WarningCircle size={14} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="plugin-market__listing-description">{listing.description}</span>
      </Button>
      <div className="plugin-market__listing-action">{action}</div>
    </article>
  );
};

interface SectionProps {
  title: string;
  listings: PluginMarketListing[];
  busyKey: string | null;
  onOpen: (listing: PluginMarketListing) => void;
  onInstall: (listing: PluginMarketListing) => void;
  onConnect: (listing: PluginMarketListing) => void;
  onExplore: (listing: PluginMarketListing) => void;
}

const busyKeyFor = (listing: PluginMarketListing): string => {
  if (listing.installState === 'available') return `install:${listing.id}`;
  if (listing.installState === 'installed') return `connect:${listing.id}`;
  return `explore:${listing.id}`;
};

export const PluginListingSection = ({
  title,
  listings,
  busyKey,
  onOpen,
  onInstall,
  onConnect,
  onExplore,
}: SectionProps) => (
  <section className="plugin-market__section" aria-label={title}>
    <h2>{title}</h2>
    <div className="plugin-market__listing-grid">
      {listings.map((listing) => (
        <PluginListingRow
          key={listing.id}
          listing={listing}
          busy={busyKey === busyKeyFor(listing)}
          onOpen={() => onOpen(listing)}
          onInstall={() => onInstall(listing)}
          onConnect={() => onConnect(listing)}
          onExplore={() => onExplore(listing)}
        />
      ))}
    </div>
  </section>
);
