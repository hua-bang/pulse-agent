import type {
  WebReadInput,
  WebReadResult,
} from '../../../shared/web';

export type * from '../../../shared/web';

export interface WebApi {
  read: (payload: WebReadInput) => Promise<WebReadResult>;
}
