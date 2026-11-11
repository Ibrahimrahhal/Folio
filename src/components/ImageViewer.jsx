import { useEffect, useRef, useState } from 'react';
import { trapFocus } from '../focusTrap.js';

const ZOOM_FACTOR = 1.25;
const MAX_ZOOM = 8;
const SIDE_PAD = 32;
const EDGE_PAD = 72;
const PAN_STEP = 80;

// image: { src } for something already loadable, or { load } returning a Blob or URL.
// alt is the caption; hint is the on-page size, used when the file has no intrinsic size.
export default function ImageViewer({ image, onClose }) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const drag = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [src, setSrc] = useState(image.src || '');
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState(null);
  const [stage, setStage] = useState(null);
  const [view, setView] = useState(null);
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (image.src || !image.load) return undefined;
    let cancelled = false;
    let objectUrl = '';
    Promise.resolve()
      .then(() => image.load())
      .then((result) => {
        if (cancelled) return;
        if (result instanceof Blob) {
          objectUrl = URL.createObjectURL(result);
          setSrc(objectUrl);
        } else if (result) {
          setSrc(String(result));
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit on first layout, and keep fitting through window resizes until the reader zooms.
  useEffect(() => {
    if (!natural || !stage) return;
    setView((current) => {
      if (!current || current.fitted) return fitted(natural, stage);
      return clampView(current, natural, stage);
    });
  }, [natural, stage]);

  useEffect(() => {
    const returnTo = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  useEffect(() => {
    // Capture phase, and nothing propagates: the book behind must not page, zoom or close.
    function onKey(event) {
      const key = event.key;
      if (key === 'F11') return;
      event.stopPropagation();
      if (key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (key === 'Tab') {
        trapFocus(event, dialogRef.current);
        return;
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        zoomBy(ZOOM_FACTOR);
      } else if (key === '-' || key === '_') {
        event.preventDefault();
        zoomBy(1 / ZOOM_FACTOR);
      } else if (key === '0') {
        event.preventDefault();
        fit();
      } else if (key.startsWith('Arrow')) {
        event.preventDefault();
        const dx = key === 'ArrowLeft' ? PAN_STEP : key === 'ArrowRight' ? -PAN_STEP : 0;
        const dy = key === 'ArrowUp' ? PAN_STEP : key === 'ArrowDown' ? -PAN_STEP : 0;
        pan(dx, dy);
      } else if (key === ' ' || key === 'PageDown' || key === 'PageUp' || key === 'Home' || key === 'End') {
        if (!(event.target instanceof HTMLElement && event.target.closest('button'))) event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    function onWheel(event) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
      const factor = Math.exp(-event.deltaY * unit * 0.0015);
      const rect = el.getBoundingClientRect();
      zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top, false);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function limits() {
    const fitScale = fitted(natural, stage).scale;
    return { min: Math.min(fitScale, 1), max: Math.max(MAX_ZOOM, fitScale * 4), fit: fitScale };
  }

  function zoomAt(factor, px, py, animate) {
    const current = viewRef.current;
    if (!current || !natural || !stage) return;
    const { min, max } = limits();
    const scale = Math.min(max, Math.max(min, current.scale * factor));
    if (scale === current.scale) return;
    const ratio = scale / current.scale;
    setView(clampView({
      scale,
      x: px - (px - current.x) * ratio,
      y: py - (py - current.y) * ratio,
      fitted: false,
      animate,
    }, natural, stage));
  }

  function zoomBy(factor) {
    if (!stage) return;
    zoomAt(factor, stage.w / 2, stage.h / 2, true);
  }

  function fit() {
    if (!natural || !stage) return;
    setView({ ...fitted(natural, stage), animate: true });
  }

  function pan(dx, dy) {
    const current = viewRef.current;
    if (!current || !natural || !stage) return;
    setView(clampView({ ...current, x: current.x + dx, y: current.y + dy, animate: true }, natural, stage));
  }

  function toggleAt(px, py) {
    const current = viewRef.current;
    if (!current) return;
    const { fit: fitScale } = limits();
    if (current.scale > fitScale + 0.001) {
      fit();
      return;
    }
    const target = Math.max(1, fitScale * 2);
    zoomAt(target / current.scale, px, py, true);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: view?.x || 0,
      y: view?.y || 0,
      onImage: event.target === imgRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    if (!state.moved) setDragging(true);
    state.moved = true;
    const current = viewRef.current;
    if (!current || !natural || !stage) return;
    setView(clampView({ ...current, x: state.x + dx, y: state.y + dy, animate: false }, natural, stage));
  }

  function onPointerUp(event) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (state.moved) return;
    if (state.onImage) {
      const rect = stageRef.current.getBoundingClientRect();
      toggleAt(event.clientX - rect.left, event.clientY - rect.top);
    } else {
      onClose();
    }
  }

  function onImageLoad(event) {
    const img = event.currentTarget;
    const hint = image.hint || {};
    const w = img.naturalWidth || Math.round(hint.w) || 800;
    const h = img.naturalHeight || Math.round(hint.h) || 600;
    // Books often stretch small files to fill the column. Open no smaller than the page showed it.
    const shown = hint.w > 0 && hint.h > 0 ? Math.min(hint.w / w, hint.h / h) : 1;
    setNatural({ w, h, floor: Math.max(1, shown) });
  }

  const fitScale = natural && stage ? fitted(natural, stage).scale : 1;
  const pannable = !!(view && natural && stage && (natural.w * view.scale > stage.w + 1 || natural.h * view.scale > stage.h + 1));
  const zoomedIn = !!(view && view.scale > fitScale + 0.001);
  const { min, max } = natural && stage ? limits() : { min: 1, max: 1 };
  const caption = String(image.alt || '').trim();

  return (
    <div
      className="image-viewer"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={caption ? `Image: ${caption}` : 'Image viewer'}
    >
      <div
        ref={stageRef}
        className={`viewer-stage${pannable ? ' pannable' : ''}${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        {!failed && !view && <p className="viewer-note">Opening image…</p>}
        {failed && <p className="viewer-note viewer-error">This image couldn’t be opened.</p>}
        {src && !failed && (
          <img
            ref={imgRef}
            className={`viewer-img${zoomedIn ? ' zoomed' : ''}${view?.animate ? ' animate' : ''}`}
            src={src}
            alt={caption}
            draggable={false}
            onLoad={onImageLoad}
            onError={() => setFailed(true)}
            style={view && natural ? {
              width: `${natural.w}px`,
              height: `${natural.h}px`,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            } : { visibility: 'hidden' }}
          />
        )}
      </div>
      <div className="viewer-bar">
        <span className="zoom-controls">
          <button
            type="button"
            className="btn-dark btn-zoom"
            onClick={() => zoomBy(1 / ZOOM_FACTOR)}
            disabled={!view || view.scale <= min + 0.001}
            aria-label="Zoom out"
          >
            −
          </button>
          <button type="button" className="zoom-label" onClick={fit} disabled={!view} aria-label="Fit to screen">
            {view ? `${Math.round(view.scale * 100)}%` : '—'}
          </button>
          <button
            type="button"
            className="btn-dark btn-zoom"
            onClick={() => zoomBy(ZOOM_FACTOR)}
            disabled={!view || view.scale >= max - 0.001}
            aria-label="Zoom in"
          >
            +
          </button>
        </span>
        <button ref={closeRef} type="button" className="btn-dark viewer-close" onClick={onClose} aria-label="Close image">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {caption && <p className="viewer-caption">{caption}</p>}
    </div>
  );
}

function fitted(natural, stage) {
  const availW = Math.max(1, stage.w - SIDE_PAD * 2);
  const availH = Math.max(1, stage.h - EDGE_PAD * 2);
  const scale = Math.min(natural.floor || 1, availW / natural.w, availH / natural.h);
  return {
    scale,
    x: (stage.w - natural.w * scale) / 2,
    y: (stage.h - natural.h * scale) / 2,
    fitted: true,
    animate: false,
  };
}

function clampView(view, natural, stage) {
  return {
    ...view,
    x: clampAxis(view.x, natural.w * view.scale, stage.w),
    y: clampAxis(view.y, natural.h * view.scale, stage.h),
  };
}

function clampAxis(offset, size, room) {
  if (size <= room) return (room - size) / 2;
  return Math.min(0, Math.max(room - size, offset));
}
