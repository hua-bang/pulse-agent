interface Props {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/** Browser window with a plus badge: the default action for creating a new web tab. */
export const NewWebTabIcon = ({ size = 16, className, strokeWidth = 1.3 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <rect
      x="2"
      y="4"
      width="12"
      height="9"
      rx="1.5"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    />
    <path
      d="M2 6.5h12"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
    <path
      d="M12 9.5v6M9 12.5h6"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </svg>
);
