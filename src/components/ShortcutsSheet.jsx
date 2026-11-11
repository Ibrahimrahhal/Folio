import { useEffect, useRef } from 'react';
import { trapFocus } from '../focusTrap.js';
import { isMac, modKey } from '../windowState.js';

export function shortcutGroups(context, format) {
  const mod = modKey();
  const fullScreen = isMac() ? [['F11'], ['⌃', '⌘', 'F']] : [['F11']];
  if (context === 'reader') {
    const vertical = format === 'epub'
      ? 'Next / previous page'
      : format === 'pdf' ? 'Scroll, turning the page at its edge' : 'Scroll down / up';
    return [
      {
        title: 'Turning pages',
        rows: [
          { keys: [['→'], ['PgDn'], ['Space']], label: 'Next page' },
          { keys: [['←'], ['PgUp'], ['Shift', 'Space']], label: 'Previous page' },
          { keys: [['↓'], ['↑']], label: vertical },
          { keys: [['Home'], ['End']], label: format === 'md' ? 'Start / end of the file' : 'First / last page' },
        ],
      },
      {
        title: 'View',
        rows: [
          { keys: [['O']], label: 'Show or hide the outline' },
          { keys: [[mod, '+'], [mod, '−']], label: 'Zoom in / out' },
          { keys: [[mod, '0']], label: 'Reset zoom' },
          { keys: fullScreen, label: 'Full screen' },
          { keys: [['Esc']], label: 'Leave full screen, close the outline, then back to the library' },
        ],
      },
      {
        title: 'Images',
        rows: [
          { keys: [['Click']], label: 'Open a picture in the viewer' },
          { keys: [['+'], ['−'], ['0']], label: 'Zoom in, out, fit to screen' },
          { keys: [['←'], ['→'], ['↑'], ['↓']], label: 'Move around a zoomed picture' },
          { keys: [['Esc']], label: 'Close the viewer' },
        ],
      },
      { title: 'Help', rows: [{ keys: [['?']], label: 'Show these shortcuts' }] },
    ];
  }
  return [
    {
      title: 'Library',
      rows: [
        { keys: [[mod, 'O']], label: 'Add a book' },
        { keys: [[mod, 'F'], ['/']], label: 'Search the shelf' },
      ],
    },
    {
      title: 'Window',
      rows: [
        { keys: fullScreen, label: 'Full screen' },
        { keys: [['?']], label: 'Show these shortcuts' },
      ],
    },
  ];
}

export default function ShortcutsSheet({ context, format, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const returnTo = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'F11') return;
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        trapFocus(event, dialogRef.current);
      } else if (!(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const groups = shortcutGroups(context, format);

  return (
    <div className="sheet-veil" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="shortcuts-sheet" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <header className="sheet-head">
          <div>
            <p className="eyebrow">Keyboard</p>
            <h2 id="shortcuts-title">Shortcuts</h2>
          </div>
          <button ref={closeRef} type="button" className="title-btn" onClick={onClose} aria-label="Close shortcuts">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="sheet-groups">
          {groups.map((group) => (
            <div key={group.title} className="sheet-group">
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.label} className="sheet-row">
                    <dt>{row.label}</dt>
                    <dd>
                      {row.keys.map((chord, index) => (
                        <span key={chord.join('+')} className="chord">
                          {index > 0 && <span className="chord-or" aria-hidden="true">/</span>}
                          {chord.map((key) => <kbd key={key}>{key}</kbd>)}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
