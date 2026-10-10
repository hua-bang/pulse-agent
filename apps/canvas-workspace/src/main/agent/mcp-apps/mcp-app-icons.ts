import type { MCPAppIcon, MCPAppToolDescriptor } from 'pulse-coder-engine/built-in';
import type {
  McpAppEntrypointListing,
  McpAppIconImage,
  McpAppIconSet,
} from '../../../shared/mcp-apps';

const MAX_ICON_BYTES = 128 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const FAILURE_RETRY_MS = 5 * 60_000;
/** Icons tried per theme; the rest of a long fallback list is ignored. */
const MAX_ICON_CANDIDATES = 4;
/** A listing waits this long for icons; slower ones land in the cache for the next listing. */
const LISTING_ICON_DEADLINE_MS = 1_500;

const ICON_KINDS: Record<string, McpAppIconImage['kind']> = {
  'image/svg+xml': 'mask',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/webp': 'image',
};

export type McpAppIconFetcher = (
  url: string,
  init: { signal: AbortSignal; redirect: 'error' },
) => Promise<Response>;

const electronFetcher: McpAppIconFetcher = async (url, init) => {
  // Chromium's network stack follows the system proxy and certificate store.
  const { net } = await import('electron');
  return net.fetch(url, init);
};

/**
 * Remote icons come from MCP tool metadata, so the privileged main process
 * only fetches public https hosts: no loopback names or IP literals, and
 * redirects are refused outright (`redirect: 'error'`).
 */
function isFetchableIconUrl(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

const normalizeMime = (value: string | null | undefined): string | undefined => {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  return mime ? mime : undefined;
};

/** Content must match its declared type; a mislabeled file is rejected. */
const matchesMime = (mime: string, bytes: Buffer): boolean => {
  if (mime === 'image/svg+xml') return /<svg[\s>]/i.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)));
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg' || mime === 'image/jpg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
};

const toImage = (mime: string | undefined, bytes: Buffer): McpAppIconImage | undefined => {
  if (!mime || bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return undefined;
  const kind = ICON_KINDS[mime];
  if (!kind || !matchesMime(mime, bytes)) return undefined;
  const canonical = mime === 'image/jpg' ? 'image/jpeg' : mime;
  return { kind, src: `data:${canonical};base64,${bytes.toString('base64')}` };
};

function decodeDataUri(icon: MCPAppIcon): McpAppIconImage | undefined {
  const match = /^data:([^,]*),(.*)$/is.exec(icon.src);
  if (!match) return undefined;
  const params = match[1].split(';');
  const base64 = params.some(param => param.trim().toLowerCase() === 'base64');
  try {
    const bytes = base64
      ? Buffer.from(match[2], 'base64')
      : Buffer.from(decodeURIComponent(match[2]), 'utf8');
    return toImage(normalizeMime(params[0]) ?? normalizeMime(icon.mimeType), bytes);
  } catch {
    return undefined;
  }
}

async function readCapped(response: Response): Promise<Buffer | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return undefined;
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ICON_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Turns MCP `icons` into renderer-safe data URIs. Remote icons are fetched by
 * the main process (https only, size-capped, type-checked) so the renderer
 * never contacts an MCP server's icon host. Results are cached per `src`.
 */
export function createMcpAppIconResolver(fetcher: McpAppIconFetcher = electronFetcher) {
  const cache = new Map<string, { at: number; image: Promise<McpAppIconImage | undefined> }>();

  const fetchIcon = async (icon: MCPAppIcon): Promise<McpAppIconImage | undefined> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetcher(icon.src, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) return undefined;
      const bytes = await readCapped(response);
      const mime = normalizeMime(response.headers.get('content-type')) ?? normalizeMime(icon.mimeType);
      return bytes ? toImage(mime, bytes) : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };

  const resolveOne = (icon: MCPAppIcon): Promise<McpAppIconImage | undefined> => {
    const cached = cache.get(icon.src);
    if (cached) return cached.image;
    const image = icon.src.startsWith('data:')
      ? Promise.resolve(decodeDataUri(icon))
      : isFetchableIconUrl(icon.src) ? fetchIcon(icon) : Promise.resolve(undefined);
    const entry = { at: Date.now(), image };
    cache.set(icon.src, entry);
    // Retry failed remote icons later instead of on every listing refresh.
    void image.then((result) => {
      if (!result) setTimeout(() => {
        if (cache.get(icon.src) === entry) cache.delete(icon.src);
      }, FAILURE_RETRY_MS).unref?.();
    });
    return image;
  };

  /** First usable icon for each theme; untagged icons serve both. */
  const resolve = async (icons: MCPAppIcon[] = []): Promise<McpAppIconSet | undefined> => {
    // Candidates resolve in parallel; the first usable one in declared order wins.
    const pick = async (theme: 'light' | 'dark'): Promise<McpAppIconImage | undefined> => {
      const candidates = icons
        .filter(item => item.theme === theme || !item.theme)
        .slice(0, MAX_ICON_CANDIDATES);
      const images = await Promise.all(candidates.map(resolveOne));
      return images.find((image): image is McpAppIconImage => Boolean(image));
    };
    const [light, dark] = await Promise.all([pick('light'), pick('dark')]);
    const fallback = light ?? dark;
    if (!fallback) return undefined;
    return dark && dark !== fallback ? { default: fallback, dark } : { default: fallback };
  };

  return { resolve };
}

const defaultResolver = createMcpAppIconResolver();

/** Adds the resolved icon of each listing's tool; listings without one keep the letter tile. */
export async function withMcpAppIcons(
  listings: McpAppEntrypointListing[],
  apps: MCPAppToolDescriptor[],
  resolver: { resolve: (icons?: MCPAppIcon[]) => Promise<McpAppIconSet | undefined> } = defaultResolver,
): Promise<McpAppEntrypointListing[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), LISTING_ICON_DEADLINE_MS);
  });
  try {
    return await Promise.all(listings.map(async (listing) => {
      const app = apps.find(item => item.serverName === listing.serverName && item.toolName === listing.toolName);
      const icon = app?.icons?.length
        ? await Promise.race([resolver.resolve(app.icons), deadline])
        : undefined;
      return icon ? { ...listing, icon } : listing;
    }));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
