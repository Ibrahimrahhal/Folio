import { useWindowState } from '../windowState.js';

export function openShortcuts() {
  window.dispatchEvent(new CustomEvent('folio:shortcuts'));
}

export function ShortcutsButton() {
  return (
    <button type="button" className="title-btn" onClick={openShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts  ?">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1.75" y="4.25" width="14.5" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.75 7.25h.5M7.25 7.25h.5M9.75 7.25h.5M12.25 7.25h.5M6 10.75h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// Folio's own caption buttons for Windows and Linux. macOS keeps its traffic lights.
// They stay out of the tab order, like native caption buttons; F11 and the system keys cover the keyboard.
export default function WindowControls() {
  const { maximized, fullScreen, focused } = useWindowState();
  const frame = window.folio?.frame;
  if (!frame?.custom) return null;
  const restoreLabel = fullScreen ? 'Exit full screen' : maximized ? 'Restore' : 'Maximize';

  return (
    <div className={`window-controls${focused ? '' : ' is-blurred'}`} role="group" aria-label="Window">
      <button type="button" tabIndex={-1} className="wc wc-min" onClick={() => frame.minimize()} aria-label="Minimize" title="Minimize">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.5h7" />
        </svg>
      </button>
      <button type="button" tabIndex={-1} className="wc wc-max" onClick={() => frame.toggleMaximize()} aria-label={restoreLabel} title={restoreLabel}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {fullScreen ? (
            <path d="M4.75 2v2.75H2M7.25 2v2.75H10M4.75 10V7.25H2M7.25 10V7.25H10" />
          ) : maximized ? (
            <>
              <rect x="2.25" y="4" width="5.75" height="5.75" rx="1.1" />
              <path d="M4.25 2.25h4.4c.6 0 1.1.5 1.1 1.1v4.4" />
            </>
          ) : (
            <rect x="2.5" y="2.5" width="7" height="7" rx="1.4" />
          )}
        </svg>
      </button>
      <button type="button" tabIndex={-1} className="wc wc-close" onClick={() => frame.close()} aria-label="Close" title="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
