export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  const stepped = Math.round(number * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export function snapshotProgress(location) {
  if (!location) return '';
  return JSON.stringify({
    percentage: round4(location.percentage),
    pdfPage: location.pdfPage || null,
    pageCount: location.pageCount || null,
    cfi: location.cfi || null,
    scrollRatio: location.scrollRatio == null ? null : round4(location.scrollRatio),
    zoom: clampZoom(location.zoom),
  });
}

function round4(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10000) / 10000;
}

export function percentLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.min(1, Math.max(0, number)) * 100);
}

export function statusWord(value) {
  const pct = percentLabel(value);
  if (pct >= 100) return 'Finished';
  if (pct <= 0) return 'Not started';
  return 'Reading';
}

export function formatLabel(format) {
  if (format === 'pdf') return 'PDF';
  if (format === 'epub') return 'EPUB';
  return 'MD';
}

export function pluralBooks(count) {
  if (count === 0) return 'Nothing on the shelf yet.';
  if (count === 1) return 'One book, kept on this machine.';
  return `${count} books, kept on this machine.`;
}

export function coverSrc(book) {
  if (book.coverUrl) return book.coverUrl;
  if (!book.hasCover) return null;
  const version = encodeURIComponent(book.coverUpdatedAt || book.id);
  return `folio://cover/${book.id}?v=${version}`;
}

export function toArrayBuffer(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
