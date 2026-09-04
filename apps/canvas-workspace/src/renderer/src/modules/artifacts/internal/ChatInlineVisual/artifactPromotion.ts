import type { InlineVisualPayload } from './types';

type CreateArtifact = (payload: InlineVisualPayload) => Promise<string | null>;

export interface ArtifactPromotion {
  promote: (payload: InlineVisualPayload) => Promise<string | null>;
}

export const createArtifactPromotion = (create: CreateArtifact): ArtifactPromotion => {
  let savedId: string | null = null;
  let pending: Promise<string | null> | null = null;

  return {
    promote: async (payload) => {
      if (savedId) return savedId;
      if (pending) return await pending;

      pending = create(payload).then((id) => {
        if (id) savedId = id;
        return id;
      });
      try {
        return await pending;
      } finally {
        pending = null;
      }
    },
  };
};
