/**
 * Context holding the currently-opened artifact for the right-side drawer.
 *
 * Any component (a chat artifact card, the iframe node body, etc.) can call
 * `useArtifactDrawer().open(workspaceId, artifactId)` to surface an artifact
 * in the side drawer without prop-drilling through the whole tree.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface OpenArtifactRef {
  workspaceId: string;
  artifactId: string;
}

interface ArtifactDrawerContextValue {
  open: OpenArtifactRef | null;
  openArtifact: (workspaceId: string, artifactId: string) => void;
  close: () => void;
}

const ArtifactDrawerContext = createContext<ArtifactDrawerContextValue | null>(null);

export const ArtifactDrawerProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState<OpenArtifactRef | null>(null);

  const openArtifact = useCallback((workspaceId: string, artifactId: string) => {
    setOpen({ workspaceId, artifactId });
  }, []);

  const close = useCallback(() => setOpen(null), []);

  const value = useMemo<ArtifactDrawerContextValue>(
    () => ({ open, openArtifact, close }),
    [open, openArtifact, close],
  );

  return (
    <ArtifactDrawerContext.Provider value={value}>
      {children}
    </ArtifactDrawerContext.Provider>
  );
};

export const useArtifactDrawer = (): ArtifactDrawerContextValue => {
  const ctx = useContext(ArtifactDrawerContext);
  if (!ctx) {
    throw new Error('useArtifactDrawer must be used within <ArtifactDrawerProvider>');
  }
  return ctx;
};
