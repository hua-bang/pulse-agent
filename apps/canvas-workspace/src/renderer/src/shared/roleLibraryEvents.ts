type RoleLibraryListener = () => void | Promise<void>;

const listeners = new Set<RoleLibraryListener>();

export const subscribeRoleLibraryChanged = (listener: RoleLibraryListener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const notifyRoleLibraryChanged = async (): Promise<void> => {
  await Promise.all([...listeners].map((listener) => listener()));
};
