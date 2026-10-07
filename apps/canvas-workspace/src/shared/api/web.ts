import type {
  WebReadInput,
  WebReadResult,
} from '../web';

export type * from '../web';

export interface WebApi {
  read: (payload: WebReadInput) => Promise<WebReadResult>;
}
