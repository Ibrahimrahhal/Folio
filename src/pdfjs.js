import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(workerUrl, window.location.href).toString();

function assetUrl(folder) {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${folder}/`;
}

export async function openPdf(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    useSystemFonts: true,
  });
  return task.promise;
}

export { pdfjs };
