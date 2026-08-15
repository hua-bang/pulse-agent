import { ReferenceLinkIcon } from '../../icons';

export const ListIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 6h10M3 10h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const BranchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3v9M4 6h5a3 3 0 003-3M4 10h5a3 3 0 013 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M7.1 12.2a5.1 5.1 0 100-10.2 5.1 5.1 0 000 10.2zM11 11l3 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const LinkIcon = () => (
  <ReferenceLinkIcon size={13} />
);
