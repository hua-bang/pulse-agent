import { PLUGIN_BRAND_IMAGES } from '../../../../views/PluginMarket/pluginBrandAssets';

const normalizeBrand = (value: string | undefined): string => (
  value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') ?? ''
);

export function pluginMentionBrand(name: string, iconKey?: string): string {
  const explicit = normalizeBrand(iconKey);
  if (PLUGIN_BRAND_IMAGES[explicit] || explicit === 'notion') return explicit;
  const inferred = normalizeBrand(name);
  if (PLUGIN_BRAND_IMAGES[inferred] || inferred === 'notion') return inferred;
  return '';
}

export function pluginMentionIconMarkup(
  name: string,
  iconKey: string | undefined,
  size: number,
): string {
  const brand = pluginMentionBrand(name, iconKey);
  const imageUrl = PLUGIN_BRAND_IMAGES[brand];
  if (imageUrl) {
    return `<img src="${imageUrl}" alt="" width="${size}" height="${size}" />`;
  }
  if (brand === 'notion') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216 40h-48a8 8 0 0 0 0 16h16v120.85L111 44.14A8 8 0 0 0 104 40H40a8 8 0 0 0 0 16h16v144H40a8 8 0 0 0 0 16h48a8 8 0 0 0 0-16H72V79.15l73 132.71a8 8 0 0 0 7 4.14h40a8 8 0 0 0 8-8V56h16a8 8 0 0 0 0-16ZM156.73 200 77.53 56h21.74l79.2 144Z" /></svg>`;
  }
  return '';
}
