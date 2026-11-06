import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../i18n';
import { NodeTypeIcon } from '../../../../../components/icons';
import { Button } from '../../../../../components/ui';
import type { AddNodeUiOptions } from '../FloatingToolbar/types';
import type { McpAppEntrypointListing } from '../../../../../../../shared/mcp-apps';
import {
  MCP_APP_NODE_DEFAULT_SIZE,
  MCP_APP_NODE_PLUGIN_ID,
  MCP_APP_NODE_TYPE,
  mcpAppNodeBindingFromListing,
} from '../../../../../../../shared/mcp-app-node';

interface Props {
  workspaceId: string;
  onCreate: (options: AddNodeUiOptions) => void;
}

export function mcpAppNodeOptions(listing: McpAppEntrypointListing): AddNodeUiOptions {
  const size = listing.defaultSize ?? MCP_APP_NODE_DEFAULT_SIZE;
  return {
    label: listing.title,
    nodePatch: {
      title: listing.title,
      width: size.width,
      height: size.height,
      data: {
        pluginId: MCP_APP_NODE_PLUGIN_ID,
        nodeType: MCP_APP_NODE_TYPE,
        payload: { ...mcpAppNodeBindingFromListing(listing) },
      },
    },
  };
}

/** Entrypoints from every loaded MCP server (plugin market or user mcp.json). */
export const McpAppMenuItems = ({ workspaceId, onCreate }: Props) => {
  const { t } = useI18n();
  const [listings, setListings] = useState<McpAppEntrypointListing[]>([]);

  useEffect(() => {
    let cancelled = false;
    void window.canvasWorkspace.agent.mcpApps
      .listEntrypoints({ kind: "workspace", workspaceId })
      .then((result) => {
        if (!cancelled && result.ok) setListings(result.value ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceId]);

  if (listings.length === 0) return null;

  return (
    <>
      <div className="context-menu-title">{t("mcpApp.node.menuTitle")}</div>
      {listings.map((listing) => (
        <Button
          key={`${listing.serverName}:${listing.toolName}`}
          size="sm"
          className="context-menu-item"
          role="menuitem"
          onClick={() => onCreate(mcpAppNodeOptions(listing))}
        >
          <span className="context-menu-icon context-menu-icon--plugin">
            <NodeTypeIcon type="plugin" size={15} />
          </span>
          <span className="context-menu-label">
            <strong>{listing.title}</strong>
            <small>
              {t("mcpApp.node.menuDesc", { server: listing.serverName, kind: listing.kind })}
            </small>
          </span>
        </Button>
      ))}
    </>
  );
};
