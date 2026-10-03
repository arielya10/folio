const $ = selector => document.querySelector(selector);
const toast = message => {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { element.hidden = true; }, 3500);
};
const themeToggle = $('.theme-toggle');
if (themeToggle) {
  const updateThemeToggle = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeToggle.setAttribute('aria-pressed', String(dark));
    themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeToggle.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    const themeIcon = themeToggle.querySelector('span');
    if (themeIcon) themeIcon.textContent = dark ? '☀' : '☾';
  };

  themeToggle.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('folio-theme', theme); } catch { /* Optional preference. */ }
    updateThemeToggle();
  });

  updateThemeToggle();
}
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
const pasteContent = $('#paste-content');
if (pasteContent) {
  const text = pasteContent.textContent;
  const urlPattern = /(?:https?:\/\/|www\.)[^\s<>]+/g;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of text.matchAll(urlPattern)) {
    const url = match[0];
    const trailing = url.match(/[.,!?;:)\]}]+$/)?.[0] || '';
    const linkText = trailing ? url.slice(0, -trailing.length) : url;
    fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const link = document.createElement('a');
    link.className = 'paste-link';
    link.href = linkText.startsWith('www.') ? `https://${linkText}` : linkText;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = linkText;
    fragment.append(link, document.createTextNode(trailing));
    lastIndex = match.index + url.length;
  }
  if (lastIndex) {
    fragment.append(document.createTextNode(text.slice(lastIndex)));
    pasteContent.replaceChildren(fragment);
  }
}
const textarea = $('#content');
if (textarea) {
  const contentError = $('#content-error');
  let contentErrorVisible = false;
  const showContentError = () => { contentErrorVisible = true; update(); };
  const update = () => {
    const bytes = new TextEncoder().encode(textarea.value).length;
    const message = bytes > 131072 ? 'Please keep your paste under 128 KB.' : !textarea.value.trim() ? 'Give your paste a little text to get started.' : '';
    $('#text-stats').textContent = `${textarea.value.length.toLocaleString()} characters · ${(bytes / 1024).toFixed(1)} / 128 KB`;
    textarea.setCustomValidity(message);
    textarea.setAttribute('aria-invalid', String(Boolean(message)));
    if (contentError) {
      contentError.textContent = message;
      contentError.hidden = !contentErrorVisible || !message;
    }
    const lines = textarea.value.split('\n').length;
    $('#line-gutter').textContent = Array.from({ length: Math.min(lines, 2000) }, (_, index) => index + 1).join('\n');
  };
  textarea.addEventListener('input', update);
  textarea.addEventListener('invalid', event => { event.preventDefault(); showContentError(); });
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
document.querySelectorAll('[data-expires-at]').forEach(element => {
  const update = () => {
    let seconds = Math.max(0, Math.ceil((Number(element.dataset.expiresAt) - Date.now()) / 1000));
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60); seconds %= 60;
    element.textContent = days || hours || minutes || seconds
      ? `Deletes in ${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes}m ${seconds}s`
      : 'Expired — this paste is no longer available';
  };
  update(); setInterval(update, 1000);
});
if (gateway) {
  const proceed = $('#proceed-button');
  const form = $('#unlock-form');
  const sponsorError = $('#sponsor-error');
  let sponsorBlocked = false;
  let sponsorCheckPending = Boolean(gateway.dataset.sponsor);
  const readyAt = Date.now() + Number(gateway.dataset.wait);
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
    proceed.disabled = remaining > 0 || sponsorBlocked || sponsorCheckPending;
    proceed.textContent = sponsorBlocked ? 'Disable blocker to continue' : sponsorCheckPending ? 'Checking sponsor access' : remaining ? `Wait ${remaining}s` : 'Proceed to paste';
    if (!remaining) clearInterval(timer);
  };
  const timer = setInterval(tick, 200);
  tick();
  form.addEventListener('submit', event => {
    if (Date.now() < readyAt) { event.preventDefault(); return; }
    if (sponsorBlocked || isContentBlocked()) {
      event.preventDefault();
      sponsorBlocked = true;
      if (sponsorError) sponsorError.hidden = false;
      tick();
      return;
    }
    if (!gateway.dataset.sponsor) return;

    event.preventDefault();
    if (sponsorError) sponsorError.hidden = true;

    let sponsorWindow = null;
    try { sponsorWindow = window.open('about:blank', '_blank'); } catch { /* Handled below. */ }
    if (!sponsorWindow) {
      if (sponsorError) sponsorError.hidden = false;
      return;
    }

    try {
      sponsorWindow.opener = null;
      sponsorWindow.location.href = gateway.dataset.sponsor;
    } catch {
      sponsorWindow.close();
      if (sponsorError) sponsorError.hidden = false;
      return;
    }

    form.submit();
  });

  if (gateway.dataset.sponsor) {
    const bait = document.createElement('div');
    bait.className = 'ad-detection-bait adsbox ad-banner ad-unit';
    bait.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bait);
    const detectSponsorBlocking = async () => {
      try {
        let brave = false;
        try { brave = Boolean(navigator.brave && await navigator.brave.isBrave()); } catch { /* Browser API unavailable. */ }
        if (brave || isContentBlocked()) {
          sponsorBlocked = true;
          if (sponsorError) sponsorError.hidden = false;
        }
      } finally {
        bait.remove();
        sponsorCheckPending = false;
        tick();
      }
    };
    detectSponsorBlocking();
  }

  function isContentBlocked() {
    const bait = document.createElement('div');
    bait.className = 'ad-detection-bait adsbox ad-banner ad-unit';
    bait.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bait);
    const style = getComputedStyle(bait);
    const blocked = bait.offsetHeight === 0 || bait.offsetWidth === 0 || style.display === 'none' || style.visibility === 'hidden';
    bait.remove();
    return blocked;
  }
}
const nativeAd = $('[data-native-ad]');
if (nativeAd) {
  const container = nativeAd.querySelector('[data-native-ad-container]');
  const notice = nativeAd.querySelector('[data-adblock-notice]');
  const blockMessage = $('#content-block-message');
  const bait = document.createElement('div');
  bait.className = 'ad-detection-bait adsbox ad-banner ad-unit';
  bait.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bait);

  const hasRenderedAd = () => Boolean(container?.children.length && container.getBoundingClientRect().height > 20);
  const showResult = () => {
    const baitStyle = getComputedStyle(bait);
    const baitBlocked = bait.offsetHeight === 0 || bait.offsetWidth === 0 || baitStyle.display === 'none' || baitStyle.visibility === 'hidden';
    if (hasRenderedAd()) {
      notice.hidden = true;
      nativeAd.classList.remove('ad-unavailable');
      document.body.classList.remove('content-blocked');
      document.body.classList.add('ads-allowed');
      if (blockMessage) blockMessage.hidden = true;
    } else if (baitBlocked || !container?.children.length) {
      notice.hidden = false;
      nativeAd.classList.add('ad-unavailable');
      document.body.classList.add('content-blocked');
      if (blockMessage) blockMessage.hidden = false;
    }
  };

  const observer = new MutationObserver(showResult);
  if (container) observer.observe(container, { childList: true, subtree: true });
  setTimeout(() => { showResult(); bait.remove(); }, 6000);
  setTimeout(() => observer.disconnect(), 30000);
  nativeAd.querySelector('[data-reload-page]')?.addEventListener('click', () => location.reload());
}
