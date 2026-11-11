import { useEffect, useRef, useState } from 'react';
import { openPdf, pdfjs } from '../pdfjs.js';
import { findImageRegions, renderImageRegion } from '../pdfImages.js';

export default function PdfReader({ bookId, startPage, zoom = 1, controls, onLocation, onReady, onOutline, onImage }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const callbacks = useRef({ onLocation, onReady, onOutline, onImage });
  callbacks.current = { onLocation, onReady, onOutline, onImage };
  const readyOnce = useRef(false);
  const pageRef = useRef(null);
  const landAtEnd = useRef(false);
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(() => Math.max(1, startPage || 1));
  const [frameWidth, setFrameWidth] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [images, setImages] = useState({ page: 0, baseWidth: 0, regions: [] });

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
        pageRef.current = pdfPage;
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
        if (landAtEnd.current) {
          landAtEnd.current = false;
          const frame = frameRef.current;
          if (frame) frame.scrollTop = frame.scrollHeight;
        }
        findImages(pdfPage);
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

    async function findImages(pdfPage) {
      try {
        const opList = await pdfPage.getOperatorList();
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setImages({ page, baseWidth: base.width, regions: findImageRegions(opList, base, pdfjs.OPS) });
      } catch {
        // Without the drawing operations the page simply has no image targets.
      }
    }
  }, [pdf, page, frameWidth, zoom]);

  function openImage(region, index, count) {
    const pdfPage = pageRef.current;
    if (!pdfPage) return;
    callbacks.current.onImage?.({
      alt: count > 1 ? `Page ${page}, image ${index + 1} of ${count}` : `Page ${page}`,
      hint: { w: region.w * shown, h: region.h * shown },
      load: () => renderImageRegion(pdfPage, region),
    });
  }

  const regions = images.page === page ? images.regions : [];
  const shown = images.baseWidth ? (Math.max(280, frameWidth - 80) / images.baseWidth) * zoom : 1;

  function go(next, { atEnd = false } = {}) {
    if (!pdf) return;
    const target = Math.min(pdf.numPages, Math.max(1, next));
    if (target === page) {
      if (!atEnd) frameRef.current?.scrollTo?.(0, 0);
      return;
    }
    landAtEnd.current = atEnd;
    setPage(target);
    if (!atEnd) frameRef.current?.scrollTo?.(0, 0);
  }

  // Arrow keys scroll the sheet and carry on to the neighbouring page once they reach its edge.
  function scroll(delta) {
    const frame = frameRef.current;
    if (!frame) return;
    const max = frame.scrollHeight - frame.clientHeight;
    if (delta > 0 && frame.scrollTop >= max - 2) go(page + 1);
    else if (delta < 0 && frame.scrollTop <= 2) go(page - 1, { atEnd: true });
    else frame.scrollBy({ top: delta });
  }

  controls.current = {
    prev: () => go(page - 1),
    next: () => go(page + 1),
    first: () => go(1),
    last: () => go(pdf ? pdf.numPages : 1),
    goTo: (item) => { if (item.page) go(item.page); },
    scroll,
  };

  if (error) return <div className="opening opening-error">{error}</div>;

  return (
    <div className="pdf-stage" ref={frameRef}>
      {!ready && <div className="opening">Opening…</div>}
      <div className="pdf-sheet">
        <canvas ref={canvasRef} />
        <div ref={textRef} className="textLayer" />
        {regions.map((region, index) => (
          <button
            key={`${page}-${index}`}
            type="button"
            className="pdf-image-hit"
            aria-label={`View image ${index + 1} on page ${page}`}
            style={{
              left: `${region.x * shown}px`,
              top: `${region.y * shown}px`,
              width: `${region.w * shown}px`,
              height: `${region.h * shown}px`,
            }}
            onClick={() => openImage(region, index, regions.length)}
          />
        ))}
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
