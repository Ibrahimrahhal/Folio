import { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import { toArrayBuffer } from '../bookUtils.js';

export default function EpubReader({ bookId, startCfi, zoom = 1, controls, onLocation, onReady, onOutline }) {
  const holderRef = useRef(null);
  const renditionRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const callbacks = useRef({ onLocation, onReady, onOutline });
  callbacks.current = { onLocation, onReady, onOutline };
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return undefined;
    let cancelled = false;
    let book;
    let rendition;
    let observer;
    let accept = false;

    open();
    return () => {
      cancelled = true;
      accept = false;
      observer?.disconnect();
      renditionRef.current = null;
      rendition?.destroy();
      book?.destroy();
    };

    async function open() {
      try {
        const { bytes } = await window.folio.readBook(bookId);
        if (cancelled) return;
        book = ePub(toArrayBuffer(bytes));
        rendition = book.renderTo(holder, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'none',
          allowScriptedContent: true,
        });
        rendition.themes.register('folio', {
          body: {
            background: '#faf9f5',
            color: '#141413',
            'font-family': 'Georgia, "Palatino Linotype", Palatino, serif',
            'line-height': '1.65',
            padding: '0 6vw',
            margin: '0',
          },
          p: {
            'font-family': 'Georgia, "Palatino Linotype", Palatino, serif',
          },
          'h1, h2, h3': {
            'font-family': 'Georgia, "Palatino Linotype", Palatino, serif',
            'font-weight': '500',
            color: '#141413',
          },
          a: { color: '#cc785c' },
          img: { 'max-width': '100%' },
        });
        rendition.themes.select('folio');
        rendition.themes.fontSize(`${Math.round(zoomRef.current * 100)}%`);
        renditionRef.current = rendition;

        const report = (location) => {
          if (!accept || !location?.start) return;
          const percentage = percentageFrom(location, book);
          callbacks.current.onLocation({
            percentage,
            cfi: location.start.cfi,
            outlineHref: location.start.href,
            atStart: !!location.atStart,
            atEnd: !!location.atEnd,
            detail: chapterLabel(location),
          });
        };

        rendition.on('relocated', report);
        try {
          await rendition.display(startCfi || undefined);
        } catch {
          await rendition.display();
        }
        if (cancelled) return;
        accept = true;
        controls.current = {
          prev: () => rendition.prev(),
          next: () => rendition.next(),
          first: () => rendition.display(undefined),
          last: () => {
            const section = book.spine?.get?.((book.spine.length || 1) - 1);
            if (section?.href) rendition.display(section.href);
          },
          goTo: (item) => {
            if (item.href) rendition.display(item.href);
          },
        };
        callbacks.current.onOutline?.(flattenEpubToc(book.navigation?.toc));
        const current = rendition.currentLocation();
        if (current) report(current);
        setReady(true);
        callbacks.current.onReady();

        observer = new ResizeObserver(() => {
          const rect = holder.getBoundingClientRect();
          rendition.resize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
        });
        observer.observe(holder);

        const cached = await window.folio.readSidecar(bookId, 'locations');
        if (cancelled) {
          observer.disconnect();
          return;
        }
        if (cached) {
          book.locations.load(cached);
          const located = rendition.currentLocation();
          if (located) report(located);
        } else {
          book.locations.generate(1600).then((locations) => {
            if (cancelled) return;
            window.folio.writeSidecar(bookId, 'locations', book.locations.save()).catch(() => {});
            const located = rendition.currentLocation();
            if (located) report(located);
            return locations;
          }).catch(() => {});
        }

      } catch {
        if (!cancelled) setError('This EPUB couldn’t be opened.');
      }
    }
  }, [bookId, startCfi, controls]);

  useEffect(() => {
    renditionRef.current?.themes?.fontSize(`${Math.round(zoom * 100)}%`);
  }, [zoom]);

  return (
    <div className="epub-stage">
      {!ready && !error && <div className="opening">Opening…</div>}
      {error && <div className="opening opening-error">{error}</div>}
      <div ref={holderRef} className="epub-view" />
    </div>
  );
}

function percentageFrom(location, book) {
  if (location.atEnd) return 1;
  if (typeof location.start.percentage === 'number' && Number.isFinite(location.start.percentage)) {
    return location.start.percentage;
  }
  const spineLength = Math.max(1, book?.spine?.length || 1);
  const index = location.start.index || 0;
  const displayed = location.start.displayed;
  const fraction = displayed?.total ? Math.max(0, displayed.page - 1) / displayed.total : 0;
  if (location.atStart && index === 0 && fraction === 0) return 0;
  return Math.min(1, (index + fraction) / spineLength);
}

function chapterLabel(location) {
  const href = location.start.href || '';
  const name = decodeURIComponent(href.split('/').pop() || 'EPUB').replace(/\.xhtml$|\.html$/i, '');
  const pretty = name.replace(/[_-]+/g, ' ').trim();
  return pretty ? `EPUB  ·  ${pretty}` : 'EPUB';
}

function flattenEpubToc(items, depth = 0, out = []) {
  for (const item of items || []) {
    const title = String(item.label || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title && item.href) {
      out.push({
        id: `epub-${out.length + 1}`,
        title,
        depth,
        href: item.href,
      });
    }
    if (item.subitems?.length) flattenEpubToc(item.subitems, depth + 1, out);
  }
  return out;
}
