// Spy-theme detail modal for GEO-RECON map features. Content is built with
// DOM nodes (textContent), never innerHTML, since much of it is remote data.

let current = null;

export function closeModal() {
  current?.remove();
  current = null;
}

/** el('div', {style}, ...children) helper; strings become text nodes. */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') n.style.cssText = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const k of kids.flat())
    if (k !== null && k !== undefined && k !== false)
      n.append(k instanceof Node ? k : String(k));
  return n;
}

export function link(href, text) {
  return el(
    'a',
    {
      href,
      target: '_blank',
      rel: 'noopener noreferrer',
      style: 'color:#3fe0ff',
    },
    text,
  );
}

/** Open a modal; returns the body element to fill. */
export function openModal(title) {
  closeModal();
  const body = el('div', {
    style: 'overflow-y:auto;max-height:calc(80vh - 56px);padding-right:4px',
  });
  const close = el(
    'button',
    {
      type: 'button',
      'aria-label': 'Close details', // i18n-ignore: GEO-RECON fork panel, English only
      style:
        'background:none;border:1px solid #3fe0ff;color:#3fe0ff;font:inherit;cursor:pointer;padding:0 8px',
    },
    '×',
  );
  const box = el(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      style:
        'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000;width:min(520px,calc(100vw - 32px));' +
        'max-height:80vh;background:rgba(4,7,9,.96);border:1px solid #3fe0ff;box-shadow:0 0 24px rgba(63,224,255,.25);' +
        'color:#bfefff;font:12px/1.5 ui-monospace,Menlo,monospace;padding:12px 14px',
    },
    el(
      'div',
      {
        style:
          'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px',
      },
      el(
        'div',
        {
          style:
            'color:#ffb238;letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
        },
        title,
      ),
      close,
    ),
    body,
  );
  close.addEventListener('click', closeModal);
  box.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());
  document.body.append(box);
  close.focus();
  current = box;
  return body;
}

/** Two-column field list; values wrap, never overflow. */
export function fields(rows) {
  return el(
    'dl',
    {
      style:
        'display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:0 0 8px',
    },
    rows
      .filter(([, v]) => v)
      .flatMap(([k, v]) => [
        el('dt', { style: 'color:#1a9fb8' }, k),
        el('dd', { style: 'margin:0;overflow-wrap:anywhere' }, v),
      ]),
  );
}
