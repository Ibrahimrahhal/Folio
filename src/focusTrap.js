// Keeps Tab inside an open dialog.
export function trapFocus(event, root) {
  if (!root) return;
  const items = [...root.querySelectorAll('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
