import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '../markdownDoc.js';

export default function MarkdownReader({ bookId, startRatio, zoom = 1, controls, onLocation, onReady, onOutline, onImage }) {
  const scrollerRef = useRef(null);
  const callbacks = useRef({ onLocation, onReady, onOutline, onImage });
  callbacks.current = { onLocation, onReady, onOutline, onImage };
  const readyOnce = useRef(false);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  const safeHtml = useMemo(() => DOMPurify.sanitize(html, { ADD_ATTR: ['id'] }), [html]);

  useEffect(() => {
    let cancel = false;
    window.folio.readBook(bookId).then(({ bytes }) => {
      if (cancel) return;
      const text = new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      const rendered = renderMarkdown(text);
      setHtml(rendered.html);
      callbacks.current.onOutline?.(rendered.outline);
    }).catch(() => {
      if (!cancel) setError('This Markdown file couldn’t be opened.');
    });
    return () => {
      cancel = true;
    };
  }, [bookId]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !safeHtml) return undefined;
    const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
    const report = () => {
      const range = max();
      const ratio = range === 0 ? 0 : el.scrollTop / range;
      const percentage = range === 0 ? 1 : ratio;
      const headings = [...el.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
      const edge = el.getBoundingClientRect().top;
      let outlineId = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - edge <= 48) outlineId = heading.id;
      }
      callbacks.current.onLocation({
        percentage,
        scrollRatio: ratio,
        outlineId,
        atStart: el.scrollTop <= 2,
        atEnd: range === 0 || el.scrollTop >= range - 2,
        detail: 'Markdown',
      });
    };

    const initial = Math.min(1, Math.max(0, startRatio || 0));
    requestAnimationFrame(() => {
      const range = max();
      el.scrollTop = range * initial;
      report();
      if (!readyOnce.current) {
        readyOnce.current = true;
        callbacks.current.onReady();
      }
    });

    const onScroll = () => report();
    el.addEventListener('scroll', onScroll, { passive: true });
    const openImage = (img) => {
      const rect = img.getBoundingClientRect();
      callbacks.current.onImage?.({
        src: img.currentSrc || img.src,
        alt: img.alt || img.title || '',
        hint: { w: rect.width, h: rect.height },
      });
    };
    // Only pictures that actually decoded become targets. A link around an image keeps
    // its link, since that is usually where the author meant the click to go.
    const pictures = [...el.querySelectorAll('.markdown img')].filter((img) => !img.closest('a[href]'));
    for (const img of pictures) {
      img.decode().then(() => {
        if (!img.isConnected) return;
        img.classList.add('md-zoomable');
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        img.setAttribute('aria-label', img.alt ? `View image: ${img.alt}` : 'View image');
      }, () => {});
    }
    const onClick = (event) => {
      const picture = event.target.closest?.('img.md-zoomable');
      if (picture) {
        event.preventDefault();
        openImage(picture);
        return;
      }
      const link = event.target.closest?.('a');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        window.folio.openExternal(href);
      }
    };
    el.addEventListener('click', onClick);
    const onKeyDown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const picture = event.target.closest?.('img.md-zoomable');
      if (!picture) return;
      event.preventDefault();
      event.stopPropagation();
      openImage(picture);
    };
    el.addEventListener('keydown', onKeyDown);
    controls.current = {
      prev: () => el.scrollBy({ top: -el.clientHeight * 0.86 }),
      next: () => el.scrollBy({ top: el.clientHeight * 0.86 }),
      first: () => { el.scrollTop = 0; },
      last: () => { el.scrollTop = el.scrollHeight; },
      scroll: (delta) => el.scrollBy({ top: delta }),
      goTo: (item) => {
        const node = el.querySelector(`#${CSS.escape(item.id)}`);
        node?.scrollIntoView({ block: 'start' });
      },
    };
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [safeHtml, startRatio, controls]);

  if (error) return <div className="opening opening-error">{error}</div>;

  return (
    <div className="md-scroll" ref={scrollerRef}>
      {!safeHtml && <div className="opening">Opening…</div>}
      <article className="markdown" style={{ zoom }} dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </div>
  );
}
