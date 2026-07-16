interface Props {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/** Arrow leaving a square — shared with the Web page toolbar. */
export const ExternalLinkIcon = ({ size = 12, className, strokeWidth = 1.2 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className={className}>
    <path
      d="M5 2H2.5A.5.5 0 0 0 2 2.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V7M7 2h3v3M5.5 6.5 10 2"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
