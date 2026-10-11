// Only this application-owned script runs in the isolated document preview.
(() => {
  const channel = document.currentScript.dataset.channel;
  if (!channel) return;
  const compact = document.currentScript.dataset.mode === 'compact';
  let selectionLocked = false;
  let linkPress;
  const root = document.documentElement;
  const style = document.createElement('style');
  style.textContent = `
    :root[data-suo-compact] body,:root[data-suo-compact] body *{-webkit-user-select:none!important;user-select:none!important}
    :root[data-suo-compact] input,:root[data-suo-compact] textarea,:root[data-suo-compact] select,:root[data-suo-compact] [contenteditable]:not([contenteditable="false"]),:root[data-suo-compact] [contenteditable]:not([contenteditable="false"]) *{-webkit-user-select:text!important;user-select:text!important}
    :root[data-suo-selection-locked] body,:root[data-suo-selection-locked] body *{-webkit-user-select:none!important;user-select:none!important}
  `;
  document.head.append(style);
  if (compact) root.dataset.suoCompact = 'true';
  const editable = target => target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const clear = () => { const selection = window.getSelection(); if (selection && selection.rangeCount !== 0) selection.removeAllRanges(); };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.channel !== channel || data.type !== 'reader-selection-lock' || typeof data.locked !== 'boolean') return;
    selectionLocked = data.locked;
    if (selectionLocked) { root.dataset.suoSelectionLocked = 'true'; clear(); }
    else delete root.dataset.suoSelectionLocked;
  });
  document.addEventListener('selectstart', event => {
    if (selectionLocked || (compact && !editable(event.target))) { event.preventDefault(); clear(); }
  }, true);
  document.addEventListener('selectionchange', () => { if (selectionLocked) clear(); });
  document.addEventListener('dblclick', event => {
    if (event.target.closest('a[data-source-url]')) { event.preventDefault(); return; }
    if (compact) clear();
    if (!event.target.closest('a,button,input,textarea,video,audio')) parent.postMessage({ channel, type: 'reader-open' }, '*');
  });
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a[data-source-url]');
    if (!anchor) return;
    event.preventDefault();
    const press = linkPress; linkPress = undefined;
    if (selectionLocked || event.detail > 1 || (event.detail > 0 && ((press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) || window.getSelection()?.toString()))) return;
    const value = anchor.dataset.sourceUrl;
    if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return;
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) parent.postMessage({ channel, type: 'reader-external-link', url: url.href }, '*');
    } catch { /* An invalid source never navigates the iframe. */ }
  });
  document.addEventListener('keydown', event => {
    if (compact && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a' && !event.target.closest('input,textarea,select,[contenteditable]')) {
      event.preventDefault(); clear();
      parent.postMessage({ channel, type: 'reader-select-all' }, '*');
    }
    if (event.key === 'Escape') { event.preventDefault(); parent.postMessage({ channel, type: 'reader-close' }, '*'); }
  });
  document.addEventListener('pointerdown', event => {
    linkPress = undefined;
    if (event.target?.closest?.('a[data-source-url]')) { linkPress = { x: event.clientX, y: event.clientY }; return; }
    if (compact && !editable(event.target)) clear();
    parent.postMessage({ channel, type: 'reader-activate', shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey }, '*');
  }, true);
  document.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    parent.postMessage({ channel, type: 'reader-zoom', x: event.clientX, y: event.clientY, delta: event.deltaY, deltaMode: event.deltaMode }, '*');
  }, { passive: false, capture: true });
})();
