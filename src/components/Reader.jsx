import { useEffect, useRef, useState } from 'react';
import { clampZoom, percentLabel, snapshotProgress, ZOOM_STEP } from '../bookUtils.js';
import EpubReader from './EpubReader.jsx';
import MarkdownReader from './MarkdownReader.jsx';
import Outline, { activeOutlineId } from './Outline.jsx';
import PdfReader from './PdfReader.jsx';

const SAVE_EVERY_MS = 5000;

export default function Reader({ book, onBack }) {
  const locationRef = useRef(null);
  const armed = useRef(false);
  const lastWritten = useRef('');
  const controls = useRef({
    prev() {},
    next() {},
    first() {},
    last() {},
  });
  const backRef = useRef(async () => {});
  const [percent, setPercent] = useState(percentLabel(book.percentage));
  const [edge, setEdge] = useState({ atStart: true, atEnd: false });
  const [detail, setDetail] = useState(book.format === 'pdf' ? 'PDF' : book.format === 'epub' ? 'EPUB' : 'Markdown');
  const [saved, setSaved] = useState(false);
  const initialZoom = clampZoom(book.location?.zoom);
  const zoomRef = useRef(initialZoom);
  const [zoom, setZoom] = useState(initialZoom);
  const [outline, setOutline] = useState([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [place, setPlace] = useState(null);

  useEffect(() => {
    document.title = `${book.title} · Folio`;
    return () => {
      document.title = 'Folio';
    };
  }, [book.title]);

  useEffect(() => {
    const timer = setInterval(() => {
      persist().catch(() => {});
    }, SAVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [book.id]);

  useEffect(() => {
    function onKey(event) {
      const target = event.target;
      const typing = target instanceof HTMLElement && target.closest('input, textarea');
      if (event.key === 'Escape') {
        event.preventDefault();
        backRef.current();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          changeZoom(zoomRef.current + ZOOM_STEP);
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          changeZoom(zoomRef.current - ZOOM_STEP);
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          changeZoom(1);
          return;
        }
      }
      if (typing) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || (event.key === ' ' && !(target instanceof HTMLElement && target.closest('button, a')))) {
        event.preventDefault();
        controls.current.next();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        controls.current.prev();
      } else if (event.key === 'Home') {
        event.preventDefault();
        controls.current.first();
      } else if (event.key === 'End') {
        event.preventDefault();
        controls.current.last();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onLocation(location) {
    locationRef.current = { ...location, zoom: zoomRef.current };
    setPercent(percentLabel(location.percentage));
    setEdge({ atStart: !!location.atStart, atEnd: !!location.atEnd });
    setPlace(location);
    if (location.detail) setDetail(location.detail);
  }

  function changeZoom(next) {
    const value = clampZoom(next);
    if (value === zoomRef.current) return;
    zoomRef.current = value;
    setZoom(value);
    if (locationRef.current) {
      locationRef.current = { ...locationRef.current, zoom: value };
    }
    persist().catch(() => {});
  }

  function onReady() {
    armed.current = true;
    lastWritten.current = snapshotProgress(locationRef.current);
  }

  async function persist() {
    if (!armed.current || !locationRef.current) return false;
    const snap = snapshotProgress(locationRef.current);
    if (!snap || snap === lastWritten.current) return false;
    await window.folio.saveProgress(book.id, locationRef.current);
    lastWritten.current = snap;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
    return true;
  }

  async function back() {
    try {
      await persist();
    } catch {
      // The five-second timer is the durability path. Leaving the book still tries once.
    }
    onBack();
  }

  backRef.current = back;

  useEffect(() => {
    function onWheel(event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      changeZoom(zoomRef.current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="reader">
      <header className="top-nav reader-nav">
        <div className="nav-cluster">
          <button type="button" className="btn-text back-btn" onClick={back}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Library
          </button>
          <button
            type="button"
            className={outlineOpen ? 'outline-toggle active' : 'outline-toggle'}
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((open) => !open)}
          >
            Outline
          </button>
        </div>
        <h1 className="reader-title">{book.title}</h1>
        <p className="reader-pct">{percent}%</p>
      </header>
      <div className="read-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="reader-body">
        {outlineOpen && (
          <Outline
            items={outline}
            activeId={activeOutlineId(outline, place)}
            emptyLabel={emptyOutlineLabel(book.format)}
            onClose={() => setOutlineOpen(false)}
            onOpenItem={(item) => controls.current.goTo?.(item)}
          />
        )}
        <div className="reader-stage">
        {book.format === 'pdf' && (
          <PdfReader
            bookId={book.id}
            startPage={book.location?.pdfPage || 1}
            zoom={zoom}
            controls={controls}
            onLocation={onLocation}
            onReady={onReady}
            onOutline={setOutline}
          />
        )}
        {book.format === 'epub' && (
          <EpubReader
            bookId={book.id}
            startCfi={book.location?.cfi || null}
            zoom={zoom}
            controls={controls}
            onLocation={onLocation}
            onReady={onReady}
            onOutline={setOutline}
          />
        )}
        {book.format === 'md' && (
          <MarkdownReader
            bookId={book.id}
            startRatio={typeof book.location?.scrollRatio === 'number' ? book.location.scrollRatio : 0}
            zoom={zoom}
            controls={controls}
            onLocation={onLocation}
            onReady={onReady}
            onOutline={setOutline}
          />
        )}
        </div>
      </div>
      <footer className="reader-status">
        <span>{detail}</span>
        <span className="status-actions">
          <span className="zoom-controls">
            <button
              type="button"
              className="btn-dark btn-zoom"
              onClick={() => changeZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= 0.7}
              aria-label="Zoom out"
            >
              −
            </button>
            <button type="button" className="zoom-label" onClick={() => changeZoom(1)} aria-label="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn-dark btn-zoom"
              onClick={() => changeZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= 2}
              aria-label="Zoom in"
            >
              +
            </button>
          </span>
          <button type="button" className="btn-dark" onClick={() => controls.current.prev()} disabled={edge.atStart}>
            Previous
          </button>
          <button type="button" className="btn-dark" onClick={() => controls.current.next()} disabled={edge.atEnd}>
            Next
          </button>
        </span>
        <span className="saved-slot">
          {saved && (
            <>
              <span className="saved-dot" />
              Saved
            </>
          )}
        </span>
      </footer>
    </div>
  );
}

function emptyOutlineLabel(format) {
  if (format === 'pdf') return 'This PDF has no bookmarks.';
  if (format === 'epub') return 'This EPUB has no table of contents.';
  return 'This file has no headings.';
}
