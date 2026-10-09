import { useEffect, useRef } from 'react';

export default function Outline({ items, activeId, emptyLabel, onClose, onOpenItem }) {
  const listRef = useRef(null);

  useEffect(() => {
    const current = listRef.current?.querySelector('.outline-item.active');
    current?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <aside className="outline" aria-label="Outline">
      <div className="outline-head">
        <p className="eyebrow">Outline</p>
        <button type="button" className="btn-text" onClick={onClose}>
          Close
        </button>
      </div>
      {items.length === 0 ? (
        <p className="outline-empty">{emptyLabel}</p>
      ) : (
        <nav className="outline-list" ref={listRef}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeId ? 'outline-item active' : 'outline-item'}
              style={{ paddingLeft: `${12 + item.depth * 14}px` }}
              onClick={() => onOpenItem(item)}
            >
              {item.title}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}

export function activeOutlineId(items, place) {
  if (!place || items.length === 0) return null;
  if (place.outlineId && items.some((item) => item.id === place.outlineId)) return place.outlineId;
  if (place.outlineHref) {
    const match = [...items].reverse().find((item) => sameTarget(item.href, place.outlineHref));
    if (match) return match.id;
  }
  if (place.pdfPage) {
    let match = null;
    for (const item of items) {
      if (item.page && item.page <= place.pdfPage) match = item.id;
    }
    return match;
  }
  return null;
}

function sameTarget(left, right) {
  const a = decodeURIComponent(String(left || '')).split('#')[0];
  const b = decodeURIComponent(String(right || '')).split('#')[0];
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}
