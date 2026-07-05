import { memo, useCallback, useState } from 'react';
import { toFileUrl } from '../../utils/fileUrl';
import { copyTextToClipboard } from '../../utils/clipboard';

export interface GeneratedImagePayload {
  ok?: boolean;
  type?: string;
  title?: string;
  outputPath?: string;
  mimeType?: string;
  addToCanvasAction?: { workspaceId?: string; imagePath?: string };
}

export const parseGeneratedImage = (result?: string): GeneratedImagePayload | null => {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as GeneratedImagePayload;
    return parsed?.ok && parsed?.type === 'generated_image' && parsed.outputPath ? parsed : null;
  } catch {
    return null;
  }
};

export const CopyGeneratedImageButton = memo(({ imagePath }: { imagePath: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      const result = await window.canvasWorkspace.file.copyImage(imagePath);
      if (!result.ok) {
        await copyTextToClipboard(toFileUrl(imagePath));
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable - ignore */
    }
  }, [imagePath]);
  return (
    <button
      type="button"
      className="chat-generated-image-card__action"
      onClick={() => void handleCopy()}
      title={copied ? 'Copied!' : 'Copy image'}
      aria-label="Copy image"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
});
CopyGeneratedImageButton.displayName = 'CopyGeneratedImageButton';
