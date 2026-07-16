interface Props {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/** Arrow leaving a square — open a resource outside the app. */
export const ExternalLinkIcon = ({ size = 14, className, strokeWidth = 1.35 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
    <path
      d="M5.25 3.25H3.2A1.2 1.2 0 0 0 2 4.45v6.35A1.2 1.2 0 0 0 3.2 12h6.35a1.2 1.2 0 0 0 1.2-1.2V8.75M8 2h4v4M7.25 6.75 12 2"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
