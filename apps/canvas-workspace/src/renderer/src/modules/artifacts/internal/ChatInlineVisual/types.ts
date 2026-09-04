import type { ArtifactType } from '../../../../types';

export interface InlineVisualPayload {
  type: ArtifactType;
  title?: string;
  content: string;
}

export interface ChatInlineVisualProps {
  workspaceId: string;
  payload?: InlineVisualPayload;
  partialInput?: string;
  streamedContent?: string;
  streaming?: boolean;
}
