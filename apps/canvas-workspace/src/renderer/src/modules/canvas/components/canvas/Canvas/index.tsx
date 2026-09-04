import {
  CanvasKeyboardActiveProvider,
  WorkspaceActiveProvider,
} from '../../../../../shared/workspaceActivity';
import { CanvasRootView } from './CanvasRootView';
import type { CanvasProps } from './types';
import { useCanvasController } from './useCanvasController';
import './index.css';

export const Canvas = (props: CanvasProps) => {
  const controller = useCanvasController(props);
  return (
    <WorkspaceActiveProvider value={props.isActive ?? true}>
      <CanvasKeyboardActiveProvider value={controller.ownsKeyboard}>
        <CanvasRootView {...controller.rootViewProps} />
      </CanvasKeyboardActiveProvider>
    </WorkspaceActiveProvider>
  );
};
