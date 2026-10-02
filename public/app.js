const $ = selector => document.querySelector(selector);
const toast = message => {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { element.hidden = true; }, 3500);
};
$('.theme-toggle')?.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('folio-theme', theme); } catch { /* Optional preference. */ }
});
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  const target = document.getElementById(button.dataset.copy);
  const text = target.tagName === 'INPUT' ? target.value : target.textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast(button.dataset.copy === 'paste-content' ? 'Text copied. Make something of it.' : 'Link copied. Pass it along.');
  } catch {
    if (target.select) target.select();
    else {
      const range = document.createRange(); range.selectNodeContents(target);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
    toast('Text selected. Use your device’s copy command.');
  }
}));
const textarea = $('#content');
if (textarea) {
  const update = () => {
    const bytes = new TextEncoder().encode(textarea.value).length;
    $('#text-stats').textContent = `${textarea.value.length.toLocaleString()} characters · ${(bytes / 1024).toFixed(1)} / 128 KB`;
    textarea.setCustomValidity(bytes > 131072 ? 'Please keep your paste under 128 KB.' : textarea.value && !textarea.value.trim() ? 'Please enter some text.' : '');
    const lines = textarea.value.split('\n').length;
    $('#line-gutter').textContent = Array.from({ length: Math.min(lines, 2000) }, (_, index) => index + 1).join('\n');
  };
  textarea.addEventListener('input', update);
  textarea.addEventListener('scroll', () => { $('#line-gutter').scrollTop = textarea.scrollTop; });
  textarea.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') $('#paste-form').requestSubmit();
  });
  $('#paste-form').addEventListener('submit', () => { $('#create-button').disabled = true; $('#create-button').textContent = 'Creating paste…'; });
  window.addEventListener('pageshow', () => { $('#create-button').disabled = false; $('#create-button').textContent = 'Create paste ↗'; });
  update();
}
$('#wrap-button')?.addEventListener('click', event => {
  const enabled = $('#paste-content').classList.toggle('wrap');
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
});
const gateway = $('#gateway');
if (gateway) {
  const proceed = $('#proceed-button');
  const fallback = $('#fallback-button');
  const readyAt = Date.now() + Number(gateway.dataset.wait);
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
    proceed.disabled = remaining > 0;
    if (fallback) fallback.disabled = remaining > 0;
    proceed.textContent = remaining ? `Ready in ${remaining}…` : 'Proceed to paste ↗';
    $('#countdown-message').textContent = remaining ? 'Getting your paste ready…' : 'All set. Continue when you’re ready.';
    if (!remaining) clearInterval(timer);
  };
  const timer = setInterval(tick, 200);
  tick();
  $('#unlock-form').addEventListener('submit', event => {
    if (Date.now() < readyAt) { event.preventDefault(); return; }
    if (gateway.dataset.sponsor && event.submitter?.id !== 'fallback-button') {
      // Open only during an explicit user action. Ad failures must never cancel the form.
      try { window.open(gateway.dataset.sponsor, '_blank', 'noopener,noreferrer'); } catch { /* Continue to the paste. */ }
    }
  });
}
