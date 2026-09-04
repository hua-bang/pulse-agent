import {
  Browser,
  CalendarBlank,
  ChartLineUp,
  Code,
  Database,
  EnvelopeSimple,
  FigmaLogo,
  FileXls,
  GithubLogo,
  GoogleDriveLogo,
  MicrosoftOutlookLogo,
  NotionLogo,
  Presentation,
  PuzzlePiece,
  Robot,
  SlackLogo,
  Sparkle,
  SquaresFour,
  TerminalWindow,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import type { PluginMarketListing } from '../../../../../shared/plugin-market';
import { normalizePluginIconKey, PLUGIN_BRAND_IMAGES } from './pluginBrandAssets';

const ICONS: Record<string, Icon> = {
  browser: Browser,
  calendar: CalendarBlank,
  chart: ChartLineUp,
  code: Code,
  database: Database,
  email: EnvelopeSimple,
  figma: FigmaLogo,
  github: GithubLogo,
  'google-drive': GoogleDriveLogo,
  drive: GoogleDriveLogo,
  notion: NotionLogo,
  outlook: MicrosoftOutlookLogo,
  presentation: Presentation,
  slack: SlackLogo,
  spreadsheet: FileXls,
  terminal: TerminalWindow,
};

const knownIconKey = (listing: PluginMarketListing): string | undefined => {
  const explicit = normalizePluginIconKey(listing.iconKey);
  if (ICONS[explicit]) return explicit;
  const name = normalizePluginIconKey(listing.name);
  return ICONS[name] ? name : undefined;
};

const chooseIcon = (listing: PluginMarketListing): Icon => {
  const key = normalizePluginIconKey(listing.iconKey);
  const known = knownIconKey(listing);
  if (known) return ICONS[known];
  if (key.includes('github')) return GithubLogo;
  if (key.includes('figma')) return FigmaLogo;
  if (key.includes('notion')) return NotionLogo;
  if (key.includes('drive')) return GoogleDriveLogo;
  if (key.includes('slack')) return SlackLogo;
  if (listing.capabilities.hasPulseExtension) return SquaresFour;
  if (listing.capabilities.mcpServerCount > 0) return Wrench;
  if (listing.sourceFormat === 'skill-collection') return Sparkle;
  if (listing.sourceFormat === 'claude' || listing.sourceFormat === 'codex') return Robot;
  if (listing.category.toLowerCase().includes('data')) return Database;
  return PuzzlePiece;
};

interface Props {
  listing: PluginMarketListing;
  size?: number;
  className?: string;
}

export const PluginGlyph = ({ listing, size = 20, className }: Props) => {
  const iconKey = normalizePluginIconKey(listing.iconKey);
  const brandIcon = PLUGIN_BRAND_IMAGES[iconKey];
  const logoKey = brandIcon ? undefined : knownIconKey(listing);
  const Glyph = chooseIcon(listing);
  const tone = listing.id.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  const classes = ['plugin-market__glyph', className].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      data-brand={brandIcon ? iconKey : undefined}
      data-logo={logoKey}
      data-tone={brandIcon || logoKey ? undefined : tone}
      aria-hidden="true"
    >
      {brandIcon ? (
        <img src={brandIcon} alt="" width={size} height={size} />
      ) : (
        <Glyph size={size} weight={logoKey ? 'regular' : 'duotone'} />
      )}
    </span>
  );
};
