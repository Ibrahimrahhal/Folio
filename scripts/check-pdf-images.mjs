import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { findImageRegions } from '../src/pdfImages.js';

// Page 1: a placed photo, a picture painted as two strips inside a form, and a tiny icon.
// Page 2: one image covering the whole sheet, the way a scanned page is built.
// Page 3: four touching tiles of the same image, which should read as one picture.
const pages = [
  'q 200 0 0 150 100 500 cm /Im1 Do Q q /Fm1 Do Q q 8 0 0 8 20 20 cm /Im1 Do Q',
  'q 612 0 0 792 0 0 cm /Im1 Do Q',
  [100, 150, 200, 250].map((x) => `q 50 0 0 50 ${x} 300 cm /Im1 Do Q`).join(' '),
];

const expected = [
  [{ x: 100, y: 142, w: 200, h: 150 }, { x: 300, y: 592, w: 100, h: 100 }],
  [],
  [{ x: 100, y: 442, w: 200, h: 50 }],
];

const doc = await pdfjs.getDocument({ data: buildPdf(pages), isEvalSupported: false }).promise;
for (let index = 0; index < pages.length; index += 1) {
  const page = await doc.getPage(index + 1);
  const opList = await page.getOperatorList();
  const regions = findImageRegions(opList, page.getViewport({ scale: 1 }), pdfjs.OPS);
  const rounded = regions.map(({ x, y, w, h }) => ({ x: round(x), y: round(y), w: round(w), h: round(h) }));
  console.log(`page ${index + 1}`, JSON.stringify(rounded));
  if (JSON.stringify(rounded) !== JSON.stringify(expected[index])) {
    throw new Error(`page ${index + 1}: expected ${JSON.stringify(expected[index])}`);
  }
}
// getOperatorList() skips pdf.js's op folding, but the render path folds tiles into a repeat op.
const OPS = pdfjs.OPS;
const folded = findImageRegions({
  fnArray: [OPS.save, OPS.paintImageXObjectRepeat, OPS.restore],
  argsArray: [null, ['img_1', 50, 50, new Float32Array([100, 300, 150, 300, 200, 300, 250, 300])], null],
}, { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }, OPS);
if (JSON.stringify(folded.map(({ x, y, w, h }) => ({ x, y, w, h }))) !== JSON.stringify(expected[2])) {
  throw new Error(`repeat op: ${JSON.stringify(folded)}`);
}
if (regionsDensity(await doc.getPage(1)) <= 0) throw new Error('image density missing');
await doc.destroy();
console.log('pdf image regions ok');

async function regionsDensity(page) {
  const regions = findImageRegions(await page.getOperatorList(), page.getViewport({ scale: 1 }), pdfjs.OPS);
  return regions[0]?.density || 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function buildPdf(contents) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const pixels = Buffer.alloc(4 * 4 * 3, 0);
  for (let i = 0; i < pixels.length; i += 3) pixels[i] = 200;
  const imageId = add(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`, 'latin1'),
    pixels,
    Buffer.from('\nendstream', 'latin1'),
  ]));
  const formStream = 'q 100 0 0 50 0 0 cm /Im1 Do Q q 100 0 0 50 0 50 cm /Im1 Do Q';
  const formId = add(`<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Matrix [1 0 0 1 300 100] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}\nendstream`);
  const pagesId = add('');
  const pageIds = contents.map((stream) => {
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /XObject << /Im1 ${imageId} 0 R /Fm1 ${formId} 0 R >> >> >>`);
  });
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let length = chunks[0].length;
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    const body = Buffer.isBuffer(object) ? object : Buffer.from(object, 'latin1');
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(chunk);
    length += chunk.length;
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}
