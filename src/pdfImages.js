// Finds where images are painted on a PDF page and renders one of them on its own.
// Coordinates are in viewport units at scale 1 (one PDF point per CSS pixel), so callers
// multiply by their render scale to place them over the canvas.

const MIN_SIDE = 12;
const MIN_AREA = 1600;
const FULL_PAGE_SHARE = 0.85;
const JOIN_GAP = 2;
const MAX_REGIONS = 48;
const MAX_PIECES = 2000;
const MAX_SIDE_PX = 4096;
const MAX_AREA_PX = 16_000_000;
const MIN_RENDER_SCALE = 3;
const MAX_RENDER_SCALE = 12;

const IDENTITY = [1, 0, 0, 1, 0, 0];

export function findImageRegions(opList, viewport, OPS) {
  const { fnArray, argsArray } = opList;
  const pageW = viewport.width;
  const pageH = viewport.height;
  const stack = [];
  let ctm = IDENTITY;
  let annotationDepth = 0;
  const found = [];

  const push = (unitMatrix, pixelW, pixelH) => {
    if (annotationDepth > 0) return;
    const rect = unitSquareBounds(multiply(viewport.transform, multiply(ctm, unitMatrix)));
    const clipped = intersect(rect, { x: 0, y: 0, w: pageW, h: pageH });
    if (!clipped) return;
    const density = Math.max(pixelW / Math.max(rect.w, 1e-6), pixelH / Math.max(rect.h, 1e-6));
    found.push({ ...clipped, density: Number.isFinite(density) ? density : 0 });
  };

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() || IDENTITY;
        break;
      case OPS.transform:
        ctm = multiply(ctm, args);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = multiply(ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() || IDENTITY;
        break;
      case OPS.beginGroup:
        stack.push(ctm);
        if (args?.[0]?.matrix) ctm = multiply(ctm, args[0].matrix);
        break;
      case OPS.endGroup:
        ctm = stack.pop() || IDENTITY;
        break;
      case OPS.beginAnnotation:
        annotationDepth += 1;
        break;
      case OPS.endAnnotation:
        annotationDepth = Math.max(0, annotationDepth - 1);
        break;
      case OPS.paintImageXObject:
        push(IDENTITY, args?.[1] || 0, args?.[2] || 0);
        break;
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        push(IDENTITY, args?.[0]?.width || 0, args?.[0]?.height || 0);
        break;
      case OPS.paintImageXObjectRepeat: {
        const [, scaleX, scaleY, positions] = args || [];
        for (let p = 0; positions && p < positions.length; p += 2) {
          push([scaleX, 0, 0, scaleY, positions[p], positions[p + 1]], 0, 0);
        }
        break;
      }
      default:
        break;
    }
  }

  const pageArea = pageW * pageH;
  return mergeTouching(found)
    .filter((r) => r.w >= MIN_SIDE && r.h >= MIN_SIDE && r.w * r.h >= MIN_AREA)
    // A picture covering the whole sheet is a scan or a background, and the text layer over it
    // has to stay selectable.
    .filter((r) => r.w * r.h < pageArea * FULL_PAGE_SHARE)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, MAX_REGIONS);
}

// Renders just the region, at the image's own resolution where the PDF says what that is.
export async function renderImageRegion(pdfPage, region) {
  const longest = Math.max(region.w, region.h);
  let scale = Math.max(MIN_RENDER_SCALE, region.density || 0);
  scale = Math.min(scale, MAX_RENDER_SCALE, MAX_SIDE_PX / longest, Math.sqrt(MAX_AREA_PX / (region.w * region.h)));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.w * scale));
  canvas.height = Math.max(1, Math.round(region.h * scale));
  const context = canvas.getContext('2d', { alpha: false });
  await pdfPage.render({
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, -region.x * scale, -region.y * scale],
  }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Could not encode the image.');
  return blob;
}

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function unitSquareBounds(m) {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

// Some PDFs paint one picture as a stack of strips or tiles. Joining touching pieces makes
// the whole picture one target instead of a dozen slivers.
function mergeTouching(rects) {
  const pool = rects.slice(0, MAX_PIECES).map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        if (!touches(pool[i], pool[j])) continue;
        pool[i] = union(pool[i], pool[j]);
        pool.splice(j, 1);
        j = i;
        changed = true;
      }
    }
  }
  return pool;
}

function touches(a, b) {
  return a.x <= b.x + b.w + JOIN_GAP
    && b.x <= a.x + a.w + JOIN_GAP
    && a.y <= b.y + b.h + JOIN_GAP
    && b.y <= a.y + a.h + JOIN_GAP;
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
    density: Math.max(a.density || 0, b.density || 0),
  };
}
