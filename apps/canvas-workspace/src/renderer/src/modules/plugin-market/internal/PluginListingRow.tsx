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
  onExplore: () => void;
}

export const PluginListingRow = ({
  listing,
  busy,
  onOpen,
  onInstall,
  onExplore,
}: Props) => {
  const { t } = useI18n();
  const action = listing.installState === 'available' ? (
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
  onExplore: (listing: PluginMarketListing) => void;
}

export const PluginListingSection = ({
  title,
  listings,
  busyKey,
  onOpen,
  onInstall,
  onExplore,
}: SectionProps) => (
  <section className="plugin-market__section" aria-label={title}>
    <h2>{title}</h2>
    <div className="plugin-market__listing-grid">
      {listings.map((listing) => (
        <PluginListingRow
          key={listing.id}
          listing={listing}
          busy={busyKey === `${listing.installState === 'available' ? 'install' : 'explore'}:${listing.id}`}
          onOpen={() => onOpen(listing)}
          onInstall={() => onInstall(listing)}
          onExplore={() => onExplore(listing)}
        />
      ))}
    </div>
  </section>
);
