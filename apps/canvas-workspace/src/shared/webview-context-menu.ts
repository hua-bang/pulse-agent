/**
 * Contract for the right-click menu of an embedded page.
 *
 * Chromium raises `context-menu` on the guest's WebContents, which lives in
 * another process — the embedder never sees the event, which is why embedded
 * pages had no menu at all. Main forwards the parameters it needs here and the
 * owning dock tab renders the menu in host chrome, so it matches the rest of
 * the app instead of being a native OS menu.
 */

export interface WebviewContextMenuRequest {
  /** Guest that raised the menu; the renderer maps it back to its dock tab. */
  sourceWebContentsId: number;
  /** Click position, in the embedder/host viewport coordinates Electron reports. */
  x: number;
  y: number;
  /** Href when the click landed on a link. */
  linkURL: string;
  /** Source when the click landed on an image/video. */
  srcURL: string;
  mediaType: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin';
  selectionText: string;
  isEditable: boolean;
}
