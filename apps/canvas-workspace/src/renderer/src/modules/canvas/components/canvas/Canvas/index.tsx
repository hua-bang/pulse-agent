import {
  CanvasKeyboardActiveProvider,
  WorkspaceActiveProvider,
} from '../../../../../shared/workspaceActivity';
import { CanvasErrorBoundary, CanvasRootErrorFallback } from '../CanvasErrorBoundary';
import { CanvasRootView } from './CanvasRootView';
import type { CanvasProps } from './types';
import { useCanvasController } from './useCanvasController';
import './index.css';

const CanvasContent = (props: CanvasProps) => {
  const controller = useCanvasController(props);
  return (
    <WorkspaceActiveProvider value={props.isActive ?? true}>
      <CanvasKeyboardActiveProvider value={controller.ownsKeyboard}>
        <CanvasRootView {...controller.rootViewProps} />
      </CanvasKeyboardActiveProvider>
    </WorkspaceActiveProvider>
  );
};

/**
 * The boundary sits outside the controller, so an error in canvas state or
 * any canvas chrome is contained here. Retry remounts and reloads the canvas
 * from storage.
 */
export const Canvas = (props: CanvasProps) => (
  <CanvasErrorBoundary
    scope={`canvas:${props.canvasId}`}
    fallback={(retry) => <CanvasRootErrorFallback onRetry={retry} />}
  >
    <CanvasContent {...props} />
  </CanvasErrorBoundary>
);
