import React, { useMemo } from "react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

interface PulseRouterContextValue {
  activeKey: string | undefined;
}

const PulseRouterContext = React.createContext<PulseRouterContextValue>({
  activeKey: undefined
})

export const usePulseRouterContext = () => React.useContext(PulseRouterContext);

interface PulseRouterProps<T extends string> {
  activeKey: T;
  children: React.ReactNode;
}

export const PulseRouter = <T extends string>(props: PulseRouterProps<T>) => {
  const {
    activeKey,
    children
  } = props;

  const contextValue = useMemo(() => {
    return {
      activeKey,
    };
  }, [activeKey]);


  return (
    <PulseRouterContext.Provider value={contextValue}>
      {children}
    </PulseRouterContext.Provider>
  );
}

interface PulseRouterViewProps {
  name: string;
  children: React.ReactNode;

  keepAlive?: boolean;
}

export const PulseRouterView: React.FC<PulseRouterViewProps> = (props) => {
  const { name, children, keepAlive } = props;

  const { activeKey } = usePulseRouterContext();

  if (activeKey === null) {
    throw new Error('RouterView must be used inside a <Router>');
  }

  const isActive = activeKey === name;

  // Each route contains its own render errors, so one broken page does not
  // blank the whole window.
  const content = <RouteErrorBoundary route={name}>{children}</RouteErrorBoundary>;

  if (keepAlive) {
    return (
      <div
        style={
          isActive
            ? { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }
            : { display: 'none' }
        }
      >
        {content}
      </div>
    );
  }

  return isActive ? content : null;
}
