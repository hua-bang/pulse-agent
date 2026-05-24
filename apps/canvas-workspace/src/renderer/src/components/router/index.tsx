import React, { useMemo } from "react";

interface PulseRouterContextValue {
  activeKey: string | undefined;
}

const PulseRouterContext = React.createContext<PulseRouterContextValue>({
  activeKey: undefined
})

const usePulseRouterContext = () => React.useContext(PulseRouterContext);

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

  if (keepAlive) {
    return (
      <div
        style={
          isActive
            ? { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }
            : { display: 'none' }
        }
      >
        {children}
      </div>
    );
  }

  return isActive ? children : null;
}
