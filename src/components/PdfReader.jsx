import { useEffect, useRef, useState } from 'react';
import { openPdf, pdfjs } from '../pdfjs.js';

export default function PdfReader({ bookId, startPage, zoom = 1, controls, onLocation, onReady, onOutline }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const callbacks = useRef({ onLocation, onReady, onOutline });
  callbacks.current = { onLocation, onReady, onOutline };
  const readyOnce = useRef(false);
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(() => Math.max(1, startPage || 1));
  const [frameWidth, setFrameWidth] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancel = false;
    let doc;
    window.folio.readBook(bookId).then(async ({ bytes }) => {
      doc = await openPdf(bytes);
      if (cancel) {
        doc.destroy();
        return;
      }
      setPdf(doc);
      setPage((current) => Math.min(doc.numPages, Math.max(1, current)));
      try {
        const outline = await flattenPdfOutline(doc, await doc.getOutline());
        if (!cancel) callbacks.current.onOutline?.(outline);
      } catch {
        if (!cancel) callbacks.current.onOutline?.([]);
      }
    }).catch((err) => {
      if (!cancel) setError(messageFor(err));
    });
    return () => {
      cancel = true;
      doc?.destroy?.();
    };
  }, [bookId]);

  useEffect(() => {
    if (!pdf || !frameWidth) return undefined;
    let cancelled = false;
    let renderTask = null;
    let textLayer = null;

    draw();
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      textLayer?.cancel?.();
    };

    async function draw() {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const canvas = canvasRef.current;
        const textLayerHost = textRef.current;
        if (!canvas || !textLayerHost) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.max(280, frameWidth - 80) / base.width;
        const scale = fit * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const context = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayerHost.style.width = `${viewport.width}px`;
        textLayerHost.style.height = `${viewport.height}px`;
        textLayerHost.replaceChildren();
        renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        if (pdfjs.TextLayer) {
          textLayer = new pdfjs.TextLayer({
            textContentSource: pdfPage.streamTextContent(),
            container: textLayerHost,
            viewport,
          });
          try {
            await textLayer.render();
          } catch {
            // The painted page stays readable when text extraction fails.
          }
        }
        callbacks.current.onLocation({
          percentage: pdf.numPages <= 1 ? 1 : page / pdf.numPages,
          pdfPage: page,
          pageCount: pdf.numPages,
          atStart: page <= 1,
          atEnd: page >= pdf.numPages,
          detail: `PDF  ·  ${page} / ${pdf.numPages}`,
        });
        if (!readyOnce.current) {
          readyOnce.current = true;
          setReady(true);
          callbacks.current.onReady();
        }
      } catch (err) {
        if (cancelled || err?.name === 'RenderingCancelledException') return;
        setError(messageFor(err));
      }
    }
  }, [pdf, page, frameWidth, zoom]);

  function go(next) {
    if (!pdf) return;
    setPage(Math.min(pdf.numPages, Math.max(1, next)));
    frameRef.current?.scrollTo?.(0, 0);
  }

  controls.current = {
    prev: () => go(page - 1),
    next: () => go(page + 1),
    first: () => go(1),
    last: () => go(pdf ? pdf.numPages : 1),
    goTo: (item) => { if (item.page) go(item.page); },
  };

  if (error) return <div className="opening opening-error">{error}</div>;

  return (
    <div className="pdf-stage" ref={frameRef}>
      {!ready && <div className="opening">Opening…</div>}
      <div className="pdf-sheet">
        <canvas ref={canvasRef} />
        <div ref={textRef} className="textLayer" />
      </div>
    </div>
  );
}

async function flattenPdfOutline(pdf, items, depth = 0, out = []) {
  for (const item of items || []) {
    const page = await destinationPage(pdf, item.dest);
    if (item.title && page) {
      out.push({
        id: `pdf-${out.length + 1}`,
        title: String(item.title).replace(/\s+/g, ' ').trim(),
        depth,
        page,
      });
    }
    if (item.items?.length) await flattenPdfOutline(pdf, item.items, page ? depth + 1 : depth, out);
  }
  return out;
}

async function destinationPage(pdf, dest) {
  if (!dest) return null;
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const index = await pdf.getPageIndex(explicit[0]);
    return index + 1;
  } catch {
    return null;
  }
}

function messageFor(error) {
  const text = error?.message || '';
  if (/password/i.test(text)) return 'This PDF is encrypted and can’t be opened.';
  return 'This PDF couldn’t be opened.';
}
