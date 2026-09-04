import type {
  CanvasMcpAuth,
  CanvasMcpServer,
  CanvasMcpTransport,
} from '../../../../../types';

export interface McpServerDraft {
  originalName?: string;
  name: string;
  transport: CanvasMcpTransport;
  url: string;
  headersText: string;
  auth: CanvasMcpAuth;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  deferTools: boolean;
}

export const createEmptyMcpDraft = (): McpServerDraft => ({
  name: '',
  transport: 'http',
  url: '',
  headersText: '',
  auth: 'none',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScope: '',
  command: '',
  argsText: '',
  envText: '',
  cwd: '',
  deferTools: false,
});

const parseKeyValues = (text: string): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key) entries[key] = trimmed.slice(separator + 1).trim();
  }
  return entries;
};

const stringifyKeyValues = (values?: Record<string, string>): string =>
  Object.entries(values ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');

export const mcpDraftForServer = (server: CanvasMcpServer): McpServerDraft => ({
  originalName: server.name,
  name: server.name,
  transport: server.transport,
  url: server.url ?? '',
  headersText: stringifyKeyValues(server.headers),
  auth: server.auth ?? 'none',
  oauthClientId: server.oauth?.clientId ?? '',
  oauthClientSecret: server.oauth?.clientSecret ?? '',
  oauthScope: server.oauth?.scope ?? '',
  command: server.command ?? '',
  argsText: (server.args ?? []).join('\n'),
  envText: stringifyKeyValues(server.env),
  cwd: server.cwd ?? '',
  deferTools: server.deferTools ?? false,
});

export const mcpServerFromDraft = (draft: McpServerDraft): CanvasMcpServer => {
  const server: CanvasMcpServer = {
    name: draft.name.trim(),
    transport: draft.transport,
    deferTools: draft.deferTools,
  };
  if (draft.transport === 'stdio') {
    server.command = draft.command.trim();
    const args = draft.argsText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const env = parseKeyValues(draft.envText);
    if (args.length) server.args = args;
    if (Object.keys(env).length) server.env = env;
    if (draft.cwd.trim()) server.cwd = draft.cwd.trim();
    return server;
  }

  server.url = draft.url.trim();
  const headers = parseKeyValues(draft.headersText);
  if (Object.keys(headers).length) server.headers = headers;
  if (draft.auth !== 'oauth') return server;
  server.auth = 'oauth';
  const oauth = {
    clientId: draft.oauthClientId.trim(),
    clientSecret: draft.oauthClientSecret.trim(),
    scope: draft.oauthScope.trim(),
  };
  const cleanOauth: NonNullable<CanvasMcpServer['oauth']> = {};
  if (oauth.clientId) cleanOauth.clientId = oauth.clientId;
  if (oauth.clientSecret) cleanOauth.clientSecret = oauth.clientSecret;
  if (oauth.scope) cleanOauth.scope = oauth.scope;
  if (Object.keys(cleanOauth).length) server.oauth = cleanOauth;
  return server;
};

export const setMcpDraftTransport = (
  draft: McpServerDraft,
  transport: CanvasMcpTransport,
): McpServerDraft => ({
  ...draft,
  transport,
  auth: transport === 'stdio' ? 'none' : draft.auth,
});
