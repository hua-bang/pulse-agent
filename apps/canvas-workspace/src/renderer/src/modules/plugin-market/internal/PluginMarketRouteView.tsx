import { useMemo, useRef, useState } from 'react';
import { WarningCircle, X } from '@phosphor-icons/react';
import type { PluginMarketListing } from '../../../../../shared/plugin-market';
import { Button, TextField } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { GitPluginModal } from './GitPluginModal';
import { PluginDetailModal } from './PluginDetailModal';
import { PluginGlyph } from './PluginGlyph';
import { PluginListingSection } from './PluginListingRow';
import { PluginMarketEmpty, PluginMarketError, PluginMarketLoading } from './PluginMarketStates';
import {
  PluginMarketActions,
  PluginMarketFilters,
  PluginMarketToolbar,
} from './PluginMarketToolbar';
import { pluginMarketKeys as keys } from './i18nKeys';
import { usePluginMarket } from './usePluginMarket';
import './index.css';
import './toolbar.css';
import './list.css';
import './modal.css';

export interface PluginMarketRouteViewProps {
  onNavigateSkills: () => void;
  onOpenSettings: () => void;
}

const searchableText = (listing: PluginMarketListing): string => [
  listing.name,
  listing.description,
  listing.author?.name,
  listing.category,
  listing.sourceFormat,
].filter(Boolean).join(' ').toLocaleLowerCase();

export const PluginMarketRouteView = ({
  onNavigateSkills,
  onOpenSettings,
}: PluginMarketRouteViewProps) => {
  const { t } = useI18n();
  const market = usePluginMarket(
    t(keys.apiUnavailable),
    t(keys.exploreUnavailable),
  );
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'personal'>('public');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  const marketRef = useRef<HTMLElement>(null);

  const listings = market.snapshot?.listings ?? [];
  const installed = listings.filter((listing) => listing.installState === 'installed');
  const visibleListings = listings.filter((listing) => listing.visibility === visibility);
  const categories = useMemo(() => Array.from(new Set(
    visibleListings.map((listing) => listing.category.trim()).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right)), [visibleListings]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = visibleListings.filter((listing) => (
    (!category || listing.category === category)
    && (!normalizedQuery || searchableText(listing).includes(normalizedQuery))
  ));
  const featured = filtered.filter((listing) => listing.featured);
  const grouped = useMemo(() => {
    const groups = new Map<string, PluginMarketListing[]>();
    for (const listing of filtered) {
      if (listing.featured) continue;
      const group = listing.category.trim() || t(keys.otherCategory);
      groups.set(group, [...(groups.get(group) ?? []), listing]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [filtered, t]);
  const selected = listings.find((listing) => listing.id === selectedId) ?? null;
  const hasFilter = Boolean(query.trim() || category);

  const openListing = (listing: PluginMarketListing) => {
    market.clearError();
    setSelectedId(listing.id);
  };

  return (
    <main ref={marketRef} className="plugin-market" aria-busy={market.loading}>
      <PluginMarketToolbar
        onNavigateSkills={onNavigateSkills}
        actions={(
          <PluginMarketActions
            refreshing={market.refreshing}
            directoryBusy={market.busyKey === 'directory'}
            onOpenSettings={onOpenSettings}
            onRefresh={() => void market.refresh()}
            onChooseDirectory={() => void market.chooseDirectory()}
            onAddGit={() => {
              market.clearError();
              setGitOpen(true);
            }}
          />
        )}
      />

      <div className="plugin-market__content">
        <header className="plugin-market__intro">
          <div>
            <span>{t(keys.kicker)}</span>
            <h1>{t(keys.title)}</h1>
            <p>{t(keys.description)}</p>
          </div>
        </header>

        <TextField
          className="plugin-market__search"
          type="search"
          value={query}
          aria-label={t(keys.searchPlaceholder)}
          placeholder={t(keys.searchPlaceholder)}
          onChange={(event) => setQuery(event.target.value)}
        />

        <section className="plugin-market__installed" aria-labelledby="plugin-market-installed-title">
          <div className="plugin-market__section-heading">
            <h2 id="plugin-market-installed-title">{t(keys.installedTitle)}</h2>
            <span>{t(keys.installedCount, { count: installed.length })}</span>
          </div>
          {installed.length > 0 ? (
            <div className="plugin-market__installed-strip">
              {installed.map((listing) => (
                <Button
                  key={listing.id}
                  variant="icon"
                  size="lg"
                  className="plugin-market__installed-button"
                  aria-label={t(keys.openDetails, { name: listing.name })}
                  title={listing.name}
                  onClick={() => openListing(listing)}
                >
                  <PluginGlyph listing={listing} size={21} />
                </Button>
              ))}
            </div>
          ) : (
            <p className="plugin-market__installed-empty">{t(keys.noInstalled)}</p>
          )}
        </section>

        <PluginMarketFilters
          visibility={visibility}
          category={category}
          categories={categories}
          onVisibilityChange={(next) => {
            setVisibility(next);
            setCategory('');
          }}
          onCategoryChange={setCategory}
        />

        {market.error && market.snapshot && (
          <div className="plugin-market__error-banner" role="alert">
            <WarningCircle size={17} />
            <span>{market.error}</span>
            <Button
              variant="icon"
              size="sm"
              aria-label={t(keys.dismissError)}
              onClick={market.clearError}
            >
              <X size={14} />
            </Button>
          </div>
        )}

        <div className="plugin-market__catalog">
          {market.loading && !market.snapshot ? (
            <PluginMarketLoading />
          ) : market.error && !market.snapshot ? (
            <PluginMarketError error={market.error} onRetry={() => void market.refresh()} />
          ) : listings.length === 0 || filtered.length === 0 ? (
            <PluginMarketEmpty
              filtered={listings.length > 0 && hasFilter}
              onClear={() => {
                setQuery('');
                setCategory('');
              }}
            />
          ) : (
            <>
              {featured.length > 0 && (
                <PluginListingSection
                  title={t(keys.featured)}
                  listings={featured}
                  busyKey={market.busyKey}
                  onOpen={openListing}
                  onInstall={(listing) => void market.install(listing.id)}
                  onExplore={(listing) => void market.explore(listing)}
                />
              )}
              {grouped.map(([title, entries]) => (
                <PluginListingSection
                  key={title}
                  title={title}
                  listings={entries}
                  busyKey={market.busyKey}
                  onOpen={openListing}
                  onInstall={(listing) => void market.install(listing.id)}
                  onExplore={(listing) => void market.explore(listing)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <GitPluginModal
        open={gitOpen}
        busy={market.busyKey === 'git'}
        error={gitOpen ? market.error : null}
        onClose={() => setGitOpen(false)}
        onSubmit={market.addGit}
      />
      <PluginDetailModal
        listing={selected}
        busyKey={market.busyKey}
        error={selected ? market.error : null}
        onClose={() => setSelectedId(null)}
        onInstall={(id) => void market.install(id)}
        onUninstall={(id) => void market.uninstall(id)}
        onConnectMcp={(id) => void market.connectMcp(id)}
        onSetNativeEnabled={(id, enabled) => void market.setNativeEnabled(id, enabled)}
        onExplore={(listing) => void market.explore(listing)}
        scopeTarget={marketRef.current}
      />
    </main>
  );
};

export default PluginMarketRouteView;
