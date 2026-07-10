import { useState } from 'react';
import {
  Button,
  Modal,
  Drawer,
  Popover,
  Select,
  TextField,
  SectionHeader,
  FieldRow,
  DropdownShell,
  SegmentedControl,
  SwatchRow,
  EmptyState,
  type SelectOption,
  type SegmentedControlOption,
  type SwatchRowOption,
} from '../../../../src/renderer/src/components/ui';
import { I18nProvider } from '../../../../src/renderer/src/i18n';

/**
 * ui/ showcase — mounts every blessed `components/ui/` piece (the 15
 * value exports in `src/renderer/src/components/ui/index.ts`: 13 components +
 * `useDragResize`/`useIndexNav` hooks) in a deterministic grid for the
 * Playwright screenshot baseline (C3 prerequisite, see
 * `docs/ui-reuse-burndown.md`).
 *
 * `Portal` and the two hooks (`useDragResize`, `useIndexNav`) have no
 * visual chrome of their own — Portal is exercised implicitly by
 * Modal/Drawer/Popover below (all three render through it or an
 * equivalent `createPortal` call); the hooks are behavior-only (already
 * covered by `components/ui/__tests__/useDragResize.test.tsx` and
 * `useIndexNav.test.tsx`), so this page does not give them their own
 * section.
 *
 * Modal/Drawer/Popover all portal to `document.body` as viewport-fixed
 * overlays with no shared containing block — mounting more than one
 * "open" at the same time would have them paint on top of each other
 * (and Modal's blurred backdrop would visually corrupt whatever sits
 * under it). So those three stay CLOSED by default (a plain trigger
 * button) and the Playwright spec opens/screenshots/closes them one at a
 * time. Everything else here (Button, Select, DropdownShell, TextField,
 * SectionHeader, FieldRow, SegmentedControl, SwatchRow, EmptyState) is
 * either static or an in-flow `position: absolute` panel (Select/
 * DropdownShell — per their own doc comments, neither one portals), so it
 * renders in its interesting state without needing a click.
 */
export const Showcase = () => (
  <I18nProvider>
    <div className="showcase-root">
      <div className="showcase-heading">
        <h1>components/ui showcase</h1>
        <p>
          Deterministic baseline for the blessed design-system set. Linux-rendered
          screenshots only — see harness/tools/ui-showcase/README.md.
        </p>
      </div>

      <ButtonSection />
      <SectionHeaderSection />
      <FieldRowSection />
      <SegmentedControlSection />
      <TextFieldSection />
      <SelectSection />
      <DropdownShellSection />
      <ModalSection />
      <DrawerSection />
      <PopoverSection />
      {/* SwatchRow/EmptyState are appended LAST, after every pre-existing
          section, on purpose: inserting them earlier pushes every later
          section down the page, changing its scroll offset when Playwright
          scrolls it into view for a per-section screenshot — confirmed
          empirically to produce sub-pixel text anti-aliasing diffs against
          the committed baselines (a real render difference, not a
          tolerance/flakiness issue) even though the crop itself is
          otherwise identical. Appending at the end leaves every
          pre-existing section's scroll position, and therefore its
          baseline, untouched. */}
      {/* Modal/Drawer/Popover's OWN tests assert on a full-viewport
          screenshot pinned to a scroll position computed from
          `section-popover`'s geometry (see ui-showcase.visual.ts's
          `pinScrollForModalTrio`) — that pin reproduces the page's
          pre-existing max-scroll clamp, whose viewport window used to end
          in this root's trailing padding (blank). Any section placed
          within ~92px of Popover's bottom edge would intrude into that
          still-visible strip and reopen the same baseline churn this
          spacer exists to prevent — 200px is a deliberate, generous
          margin above the measured ~92px shortfall. */}
      <div className="showcase-modal-trio-spacer" aria-hidden="true" />
      <SwatchRowSection />
      <EmptyStateSection />
    </div>
  </I18nProvider>
);

// ── Button ──────────────────────────────────────────────────────────────
// Per Button's own doc comment, sm/md apply to every variant; lg (32px) is
// icon-only for now — so the grid follows that constraint rather than
// rendering a cross product that doesn't occur in the real app.
const TEXT_VARIANTS = ['primary', 'secondary', 'danger'] as const;
const TEXT_SIZES = ['sm', 'md'] as const;
const ICON_SIZES = ['sm', 'md', 'lg'] as const;

const DotIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <circle cx="5" cy="5" r="4" fill="currentColor" />
  </svg>
);

const ButtonSection = () => (
  <section className="showcase-section" data-testid="section-button">
    <h2>Button</h2>
    <div className="showcase-row">
      {TEXT_VARIANTS.map((variant) =>
        TEXT_SIZES.map((size) => (
          <div className="showcase-cell" key={`${variant}-${size}`}>
            <span className="showcase-cell-label">
              {variant} / {size}
            </span>
            <Button variant={variant} size={size}>
              Action
            </Button>
          </div>
        )),
      )}
      {TEXT_VARIANTS.map((variant) => (
        <div className="showcase-cell" key={`${variant}-disabled`}>
          <span className="showcase-cell-label">{variant} / disabled</span>
          <Button variant={variant} size="sm" disabled>
            Action
          </Button>
        </div>
      ))}
    </div>
    <div className="showcase-row">
      {ICON_SIZES.map((size) => (
        <div className="showcase-cell" key={`icon-${size}`}>
          <span className="showcase-cell-label">icon / {size}</span>
          <Button variant="icon" size={size} aria-label="Icon action">
            <DotIcon />
          </Button>
        </div>
      ))}
      <div className="showcase-cell">
        <span className="showcase-cell-label">icon / disabled</span>
        <Button variant="icon" size="md" aria-label="Icon action" disabled>
          <DotIcon />
        </Button>
      </div>
    </div>
  </section>
);

// ── SectionHeader ───────────────────────────────────────────────────────
const SectionHeaderSection = () => (
  <section className="showcase-section" data-testid="section-sectionheader">
    <h2>SectionHeader</h2>
    <SectionHeader
      title="Workspace updates"
      description="Check for new releases and install them automatically."
    />
  </section>
);

// ── FieldRow ────────────────────────────────────────────────────────────
const FieldRowSection = () => (
  <section className="showcase-section" data-testid="section-fieldrow">
    <h2>FieldRow</h2>
    <FieldRow label="Notifications" hint="Applies to this workspace only.">
      <label className="showcase-fieldrow-demo">
        <input type="checkbox" defaultChecked readOnly />
        Enable desktop notifications
      </label>
    </FieldRow>
  </section>
);

// ── SegmentedControl ────────────────────────────────────────────────────
const RADIO_OPTIONS: SegmentedControlOption[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];
const TAB_OPTIONS: SegmentedControlOption[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'code', label: 'Code' },
];

const SegmentedControlSection = () => {
  const [radioValue, setRadioValue] = useState('dark');
  const [tabValue, setTabValue] = useState('preview');
  return (
    <section className="showcase-section" data-testid="section-segmented">
      <h2>SegmentedControl</h2>
      <div className="showcase-row">
        <div className="showcase-cell">
          <span className="showcase-cell-label">ariaPattern=&quot;radio&quot;</span>
          <SegmentedControl
            options={RADIO_OPTIONS}
            value={radioValue}
            onChange={setRadioValue}
            ariaLabel="Theme"
          />
        </div>
        <div className="showcase-cell">
          <span className="showcase-cell-label">ariaPattern=&quot;tab&quot;</span>
          <SegmentedControl
            options={TAB_OPTIONS}
            value={tabValue}
            onChange={setTabValue}
            ariaPattern="tab"
            ariaLabel="View"
          />
        </div>
      </div>
    </section>
  );
};

// ── SwatchRow ───────────────────────────────────────────────────────────
const SWATCH_OPTIONS: SwatchRowOption[] = [
  { value: 'transparent', label: 'None', isNone: true },
  { value: '#e5484d', label: 'Red' },
  { value: '#f76808', label: 'Orange' },
  { value: '#30a46c', label: 'Green' },
  { value: '#0091ff', label: 'Blue' },
  { value: '#8e4ec6', label: 'Purple' },
];

const SwatchRowSection = () => {
  const [menuValue, setMenuValue] = useState('#30a46c');
  const [toggleValue, setToggleValue] = useState('#e5484d');
  return (
    <section className="showcase-section" data-testid="section-swatchrow">
      <h2>SwatchRow</h2>
      <div className="showcase-columns">
        <div className="showcase-cell">
          <span className="showcase-cell-label">ariaPattern=&quot;menuitemradio&quot; (default), with a &quot;none&quot; slot</span>
          <SwatchRow options={SWATCH_OPTIONS} value={menuValue} onChange={setMenuValue} ariaLabel="Fill" />
        </div>
        <div className="showcase-cell">
          <span className="showcase-cell-label">ariaPattern=&quot;toggle&quot;</span>
          <SwatchRow
            options={SWATCH_OPTIONS}
            value={toggleValue}
            onChange={setToggleValue}
            ariaPattern="toggle"
            ariaLabel="Text color"
          />
        </div>
      </div>
    </section>
  );
};

// ── EmptyState ──────────────────────────────────────────────────────────
const EmptyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path
      d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinejoin="round"
    />
  </svg>
);

const EmptyStateSection = () => (
  <section className="showcase-section" data-testid="section-emptystate">
    <h2>EmptyState</h2>
    <div className="showcase-columns">
      <div className="showcase-cell" style={{ width: 260 }}>
        <span className="showcase-cell-label">icon + title + description + action</span>
        <EmptyState
          className="showcase-emptystate-card"
          icon={<EmptyIcon />}
          title="No pinned references"
          description="Pin a node from the canvas to see it here."
          action={<button type="button" className="showcase-menu-item">Browse nodes</button>}
        />
      </div>
      <div className="showcase-cell" style={{ width: 260 }}>
        <span className="showcase-cell-label">title + description only (no icon, no action)</span>
        <EmptyState title="No layers match" description="Try a different search term." />
      </div>
    </div>
  </section>
);

// ── TextField ───────────────────────────────────────────────────────────
// The third field is deliberately focused by the Playwright spec (a real
// `:focus-visible` ring is reproducible for text inputs — Chromium shows
// it on both click AND programmatic `.focus()` for text-editable controls,
// unlike buttons, which only go `:focus-visible` via keyboard nav — see
// harness/tools/ui-showcase/README.md's determinism note).
const TextFieldSection = () => (
  <section className="showcase-section" data-testid="section-textfield">
    <h2>TextField</h2>
    <div className="showcase-columns">
      <TextField
        label="Workspace name"
        hint="Shown in the sidebar and window title."
        defaultValue="Product roadmap"
      />
      <TextField
        label="Description"
        hint="Optional — shown on hover."
        multiline
        rows={4}
        defaultValue={'Q3 planning canvas.\nShared with the design team.'}
      />
      <TextField
        id="showcase-textfield-focus-demo"
        label="Focused example"
        hint="Captured with keyboard focus for the :focus-visible ring."
        defaultValue="Click or Tab lands here"
      />
    </div>
  </section>
);

// ── Select ──────────────────────────────────────────────────────────────
const SELECT_OPTIONS: SelectOption[] = [
  { value: 'draft', label: 'Draft', description: 'Not visible to others' },
  { value: 'review', label: 'In review' },
  { value: 'published', label: 'Published', description: 'Live for the team' },
  { value: 'archived', label: 'Archived', disabled: true },
];

const SelectSection = () => {
  const [value, setValue] = useState('review');
  return (
    <section className="showcase-section" data-testid="section-select">
      <h2>Select</h2>
      <div className="showcase-cell" style={{ width: 260 }}>
        <span className="showcase-cell-label">status</span>
        <Select
          id="showcase-select-demo"
          value={value}
          options={SELECT_OPTIONS}
          onChange={setValue}
          ariaLabel="Status"
        />
      </div>
    </section>
  );
};

// ── DropdownShell ───────────────────────────────────────────────────────
const DropdownShellSection = () => (
  <section className="showcase-section" data-testid="section-dropdown">
    <h2>DropdownShell</h2>
    <DropdownShell
      ariaLabel="Row actions"
      trigger={({ open, toggle }) => (
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          data-testid="showcase-dropdown-trigger"
          onClick={toggle}
        >
          Actions
        </Button>
      )}
    >
      {({ close }) => (
        <>
          <button type="button" className="showcase-menu-item" onClick={close}>
            Rename
          </button>
          <button type="button" className="showcase-menu-item" onClick={close}>
            Duplicate
          </button>
          <button type="button" className="showcase-menu-item" onClick={close}>
            Delete
          </button>
        </>
      )}
    </DropdownShell>
  </section>
);

// ── Modal ───────────────────────────────────────────────────────────────
const ModalSection = () => {
  const [open, setOpen] = useState(false);
  return (
    <section className="showcase-section" data-testid="section-modal">
      <h2>Modal</h2>
      <div className="showcase-trigger-row">
        <Button
          variant="secondary"
          size="sm"
          data-testid="showcase-modal-trigger"
          onClick={() => setOpen(true)}
        >
          Open modal
        </Button>
        <span className="showcase-trigger-status">
          {open ? 'open' : 'closed'} — captured by the Playwright spec, not this default state
        </span>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={420}
        labelledBy="showcase-modal-title"
        className="showcase-target-modal"
      >
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 id="showcase-modal-title" style={{ margin: 0, fontSize: 15 }}>
            Delete &quot;Product roadmap&quot;?
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            This removes the workspace canvas and its saved directory from disk.
            This action cannot be undone.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
};

// ── Drawer ──────────────────────────────────────────────────────────────
const DrawerSection = () => {
  const [open, setOpen] = useState(false);
  return (
    <section className="showcase-section" data-testid="section-drawer">
      <h2>Drawer</h2>
      <div className="showcase-trigger-row">
        <Button
          variant="secondary"
          size="sm"
          data-testid="showcase-drawer-trigger"
          onClick={() => setOpen(true)}
        >
          Open drawer
        </Button>
        <span className="showcase-trigger-status">
          {open ? 'open' : 'closed'} — captured by the Playwright spec, not this default state
        </span>
      </div>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        kicker="Settings"
        title="Workspace settings"
        ariaLabel="Workspace settings"
        width={420}
        className="showcase-target-drawer"
      >
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FieldRow label="Workspace name" hint="Shown in the sidebar.">
            <TextField defaultValue="Product roadmap" />
          </FieldRow>
          <FieldRow label="Danger zone" hint="Removes the workspace from disk.">
            <Button variant="danger" size="sm">
              Delete workspace
            </Button>
          </FieldRow>
        </div>
      </Drawer>
    </section>
  );
};

// ── Popover ─────────────────────────────────────────────────────────────
// "open at fixed x/y" per the brief — these coordinates are hardcoded
// constants, not derived from a click event, and sit well inside the
// 1200×900 showcase viewport so useViewportClampedPosition never has to
// clamp (clamping would still be deterministic, but a non-clamped anchor
// is the simpler, more legible baseline).
const POPOVER_X = 520;
const POPOVER_Y = 420;

const PopoverSection = () => {
  const [open, setOpen] = useState(false);
  return (
    <section className="showcase-section" data-testid="section-popover">
      <h2>Popover</h2>
      <div className="showcase-trigger-row">
        <Button
          variant="secondary"
          size="sm"
          data-testid="showcase-popover-trigger"
          onClick={() => setOpen(true)}
        >
          Open popover
        </Button>
        <span className="showcase-trigger-status">
          {open ? 'open' : 'closed'} at ({POPOVER_X}, {POPOVER_Y}) — captured by the
          Playwright spec, not this default state
        </span>
      </div>
      {open && (
        <Popover x={POPOVER_X} y={POPOVER_Y} onClose={() => setOpen(false)} className="showcase-popover-panel">
          <button type="button" className="showcase-menu-item" onClick={() => setOpen(false)}>
            Copy link
          </button>
          <button type="button" className="showcase-menu-item" onClick={() => setOpen(false)}>
            Move to folder
          </button>
          <button type="button" className="showcase-menu-item" onClick={() => setOpen(false)}>
            Archive
          </button>
        </Popover>
      )}
    </section>
  );
};
