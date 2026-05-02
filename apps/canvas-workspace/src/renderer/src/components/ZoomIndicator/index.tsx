import './index.css';

interface Props {
  scale: number;
  onReset: () => void;
  /** Number of currently-selected nodes. Shown as a leading chip when
   *  >0 so the user can confirm at a glance that a multi-selection is
   *  live before issuing a batch action like Cmd+D or Delete. */
  selectionCount?: number;
}

export const ZoomIndicator = ({ scale, onReset, selectionCount = 0 }: Props) => {
  const pct = Math.round(scale * 100);
  return (
    <div className="zoom-indicator-group">
      {selectionCount > 0 && (
        <span
          className="zoom-indicator zoom-indicator--selection"
          aria-live="polite"
          title={selectionCount === 1 ? '1 node selected' : `${selectionCount} nodes selected`}
        >
          {selectionCount} selected
        </span>
      )}
      <button className="zoom-indicator" onClick={onReset} title="Reset to 100%">
        {pct}%
      </button>
    </div>
  );
};
