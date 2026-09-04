import type { CanvasNode } from '../../../../../types';
import type { CreatableCanvasNodeType } from '../../../../../utils/nodeFactory';

export interface AddNodeUiOptions {
  label?: string;
  nodePatch?: Partial<CanvasNode>;
}

export type AddCanvasNode = (
  type: CreatableCanvasNodeType,
  options?: AddNodeUiOptions,
) => void;
