import { openPdf } from './pdfjs.js';

export async function enrichPdf(book) {
  const { bytes } = await window.folio.readBook(book.id);
  const pdf = await openPdf(bytes);
  try {
    const patch = { enriched: true, titleFromFile: false, pageCount: pdf.numPages };
    if (book.titleFromFile) {
      try {
        const meta = await pdf.getMetadata();
        const raw = meta?.info?.Title;
        if (typeof raw === 'string') {
          const title = raw.replace(/\s+/g, ' ').trim();
          if (title.length >= 2 && !/^untitled$/i.test(title)) patch.title = title;
        }
      } catch {
        // Filename stays the title when the PDF has no usable metadata.
      }
    }

    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.4, 520 / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      const context = canvas.getContext('2d', { alpha: false });
      if (context) {
        await page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        }).promise;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (blob) {
          const coverBytes = new Uint8Array(await blob.arrayBuffer());
          await window.folio.saveCover(book.id, coverBytes, 'image/jpeg');
        }
      }
    } catch {
      // A missing thumbnail still leaves the book readable.
    }

    await window.folio.patchBook(book.id, patch);
  } finally {
    await pdf.destroy();
  }
}
