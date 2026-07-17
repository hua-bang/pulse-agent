/**
 * Browser section of the global Settings drawer — preferences for the
 * embedded web tabs. Currently one choice: the address-bar search engine
 * (used when typed input is a query rather than a URL — see
 * `EmbeddedBrowser/address-input.ts`). Stored locally; address bars read it
 * back on every submit, so changes apply immediately to open tabs.
 *
 * Built entirely from the blessed set (SectionHeader / FieldRow /
 * SegmentedControl) — keep it that way; the ui-reuse ratchet counts
 * hand-rolled section/field/radio clusters.
 */
import { useState } from 'react';
import {
  getStoredSearchEngine,
  SEARCH_ENGINES,
  setStoredSearchEngine,
  type SearchEngineId,
} from '../EmbeddedBrowser/address-input';
import { useI18n } from '../../i18n';
import { SectionHeader, FieldRow, SegmentedControl } from '../ui';
import './BrowserSection.css';

const ENGINE_IDS = Object.keys(SEARCH_ENGINES) as SearchEngineId[];

function engineHost(id: SearchEngineId): string {
  try {
    return new URL(SEARCH_ENGINES[id].buildSearchUrl('q')).hostname;
  } catch {
    return '';
  }
}

export const BrowserSection = () => {
  const { t } = useI18n();
  const [engine, setEngine] = useState<SearchEngineId>(() => getStoredSearchEngine());

  return (
    <div className="cfg-pane">
      <div className="browser-settings">
        <SectionHeader
          title={t('settings.browser.introTitle')}
          description={t('settings.browser.introDescription')}
        />
        <FieldRow
          label={t('settings.browser.searchEngine')}
          hint={t('settings.browser.persistedHint')}
        >
          <SegmentedControl
            options={ENGINE_IDS.map((id) => ({
              id,
              label: SEARCH_ENGINES[id].label,
              title: engineHost(id),
            }))}
            value={engine}
            onChange={(id) => {
              setStoredSearchEngine(id as SearchEngineId);
              setEngine(id as SearchEngineId);
            }}
            ariaLabel={t('settings.browser.searchEngine')}
          />
        </FieldRow>
      </div>
    </div>
  );
};
