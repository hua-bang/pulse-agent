const decodePath = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Resolve only explicit local-file links. Relative Markdown links stay web navigation. */
export const localPathFromHref = (href: string): string | null => {
  const value = href.trim();
  if (!value) return null;

  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'file:') return null;
      const pathname = decodePath(url.pathname);
      return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return null;
    }
  }

  if (value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)) {
    return decodePath(value);
  }

  return null;
};
