/**
 * components/ui — the blessed design-system set. Basic capabilities (弹窗
 * / 抽屉 / 消息 / 按钮) and basic interaction behaviors. New code reuses
 * these instead of hand-rolling parallel implementations; the ratchet in
 * src/main/__tests__/ui-reuse-governance.test.ts enforces it.
 *
 * ui/ imports only from hooks/, utils/, and style tokens — never from
 * feature components, so it stays cycle-free.
 */

export { Button } from './Button';
export { Modal } from './Modal';
export { Drawer } from './Drawer';
export { useDragResize } from './hooks/useDragResize';
export type { DragResizeOptions, DragResizeHandlers } from './hooks/useDragResize';
