import { useEffect, useMemo, useRef, useState } from 'react';
import { coverSrc, formatLabel, percentLabel, pluralBooks, statusWord } from '../bookUtils.js';
import { enrichPdf } from '../enrichPdf.js';
import Spike from './Spike.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'reading', label: 'Reading' },
  { id: 'finished', label: 'Finished' },
];

export default function Library({ onOpen }) {
  const [books, setBooks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const importRef = useRef(async () => {});
  const enriching = useRef(new Set());
  const dragDepth = useRef(0);

  async function refresh() {
    const next = await window.folio.listBooks();
    setBooks(next);
    return next;
  }

  useEffect(() => {
    let cancel = false;
    refresh()
      .catch((err) => {
        if (!cancel) setError(err.message || 'The shelf could not be opened.');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, []);

  importRef.current = importBooks;

  useEffect(() => window.folio.onMenuAdd?.(() => importRef.current()), []);

  useEffect(() => {
    const pending = books.filter((book) => book.format === 'pdf' && !book.enriched && !enriching.current.has(book.id));
    pending.forEach((book) => {
      enriching.current.add(book.id);
      enrichPdf(book)
        .catch(() => window.folio.patchBook(book.id, { enriched: true }))
        .finally(() => refresh().catch(() => {}));
    });
  }, [books]);

  async function importPath(filePath) {
    const book = await window.folio.importPath(filePath);
    setBooks((current) => [book, ...current.filter((item) => item.id !== book.id)]);
  }

  async function importBooks() {
    setError('');
    setBusy(true);
    try {
      const paths = await window.folio.pickBooks();
      for (const filePath of paths) {
        try {
          await importPath(filePath);
        } catch (err) {
          setError(err.message || 'That book could not be added.');
        }
      }
    } catch (err) {
      setError(err.message || 'That book could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function onDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) {
        try {
          const filePath = window.folio.pathForFile(file);
          await importPath(filePath);
        } catch (err) {
          setError(err.message || `${file.name} could not be added.`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeBook(book) {
    setError('');
    try {
      await window.folio.removeBook(book.id);
      setBooks((current) => current.filter((item) => item.id !== book.id));
      setPendingRemove(null);
    } catch (err) {
      setError(err.message || 'That book could not be removed.');
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books.filter((book) => {
      const pct = book.percentage || 0;
      if (filter === 'reading' && (pct <= 0.005 || pct >= 0.995)) return false;
      if (filter === 'finished' && pct < 0.995) return false;
      if (!needle) return true;
      return [book.title, book.author, book.filename].join(' ').toLowerCase().includes(needle);
    });
  }, [books, filter, query]);

  const continueBook = filter === 'all' && !query.trim()
    ? books.find((book) => book.percentage > 0.005 && book.percentage < 0.995)
    : null;

  return (
    <div
      className="library"
      onDragEnter={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="top-nav">
        <div className="wordmark">
          <Spike size={16} />
          <span>Folio</span>
        </div>
        <button type="button" className="btn-primary" onClick={importBooks} disabled={busy}>
          {busy ? 'Adding…' : 'Add a book'}
        </button>
      </header>

      <main className="library-main">
        {books.length === 0 && !loading ? (
          <section className="empty">
            <div>
              <p className="eyebrow">Library</p>
              <h1>Your shelf is waiting.</h1>
              <p className="lede">
                Add a PDF, EPUB, or Markdown file. Folio copies it into its own folder and remembers where you stopped.
              </p>
              <button type="button" className="btn-primary" onClick={importBooks} disabled={busy}>
                {busy ? 'Adding…' : 'Add a book'}
              </button>
            </div>
            <div className="empty-card" aria-hidden="true">
              <BookSketch />
            </div>
          </section>
        ) : (
          <>
            <header className="library-header">
              <p className="eyebrow">On this machine</p>
              <h1>Your library</h1>
              <p className="lede">{loading ? 'Opening the shelf…' : pluralBooks(books.length)}</p>
            </header>

            {continueBook && (
              <section className="callout">
                <div className="callout-copy">
                  <p className="callout-kicker">Continue</p>
                  <h2>{continueBook.title}</h2>
                  <p>
                    {percentLabel(continueBook.percentage)}% complete
                    {continueBook.author ? ` · ${continueBook.author}` : ''}
                  </p>
                </div>
                <button type="button" className="btn-on-coral" onClick={() => onOpen(continueBook)}>
                  Resume
                </button>
              </section>
            )}

            <div className="toolbar">
              <div className="tabs" role="tablist" aria-label="Shelf">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    className={filter === item.id ? 'tab tab-active' : 'tab'}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <input
                className="input search"
                type="search"
                placeholder="Search the shelf"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search the shelf"
              />
            </div>
          </>
        )}

        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}

        {books.length > 0 && (
          visible.length > 0 ? (
            <ul className="shelf">
              {visible.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  confirming={pendingRemove === book.id}
                  onOpen={() => onOpen(book)}
                  onAskRemove={() => setPendingRemove(book.id)}
                  onCancelRemove={() => setPendingRemove(null)}
                  onRemove={() => removeBook(book)}
                />
              ))}
            </ul>
          ) : (
            <p className="empty-filter">Nothing on this shelf.</p>
          )
        )}
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <span className="mark-plate">
            <Spike size={14} />
          </span>
          <strong>Folio</strong>
        </div>
        <p>
          Books are copied into Folio’s own folder. Your place in each one is written every five seconds, so closing the app still brings you back.
        </p>
      </footer>

      {dragging && (
        <div className="drop-veil">
          <div>
            <p className="eyebrow">Add to the shelf</p>
            <h2>Drop a PDF, EPUB, or Markdown file</h2>
          </div>
        </div>
      )}
    </div>
  );
}

function BookCard({ book, confirming, onOpen, onAskRemove, onCancelRemove, onRemove }) {
  const pct = percentLabel(book.percentage);
  const src = coverSrc(book);
  const letter = (book.title || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <li className="book-card">
      <button type="button" className="book-open" onClick={onOpen}>
        <span className="cover">
          {src ? <img src={src} alt="" draggable="false" /> : (
            <span className="cover-fallback">
              <span className="monogram">{letter}</span>
            </span>
          )}
          <span className="badge">{formatLabel(book.format)}</span>
        </span>
        <span className="book-title">{book.title}</span>
      </button>
      <p className="author">{book.author || '\u00a0'}</p>
      <div className="progress-line">
        <span>{pct}%</span>
        <span>{statusWord(book.percentage)}</span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${pct}% complete`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {confirming ? (
        <div className="confirm-row">
          <button type="button" className="btn-text danger" onClick={onRemove}>
            Remove this book?
          </button>
          <button type="button" className="btn-text" onClick={onCancelRemove}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn-text" onClick={onAskRemove}>
          Remove
        </button>
      )}
    </li>
  );
}

function BookSketch() {
  return (
    <svg width="220" height="160" viewBox="0 0 220 160" fill="none" aria-hidden="true">
      <path d="M28 46c28-14 46-14 78 0v84c-32-14-50-14-78 0V46Z" stroke="#141413" strokeWidth="1.6" />
      <path d="M192 46c-28-14-46-14-86 0v84c40-14 58-14 86 0V46Z" stroke="#141413" strokeWidth="1.6" />
      <path d="M106 46v84" stroke="#cc785c" strokeWidth="1.6" />
      <path d="M48 68h40M48 84h34M128 68h40M128 84h28" stroke="#6c6a64" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
