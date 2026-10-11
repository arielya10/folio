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
  const imagePattern = /!\[([^\]]*)\]\((data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+)\)/g;
  const urlPattern = /(?:https?:\/\/|www\.)[^\s<>]+/g;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  const appendTextWithLinks = value => {
    let linkIndex = 0;
    for (const match of value.matchAll(urlPattern)) {
      const url = match[0];
      const trailing = url.match(/[.,!?;:)\]}]+$/)?.[0] || '';
      const linkText = trailing ? url.slice(0, -trailing.length) : url;
      fragment.append(document.createTextNode(value.slice(linkIndex, match.index)));
      const link = document.createElement('a');
      link.className = 'paste-link';
      link.href = linkText.startsWith('www.') ? `https://${linkText}` : linkText;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = linkText;
      fragment.append(link, document.createTextNode(trailing));
      linkIndex = match.index + url.length;
    }
    fragment.append(document.createTextNode(value.slice(linkIndex)));
  };
  for (const match of text.matchAll(imagePattern)) {
    appendTextWithLinks(text.slice(lastIndex, match.index));
    const image = document.createElement('img');
    const [alt, size] = match[1].split('|');
    image.className = 'pasted-image';
    image.alt = alt || 'Pasted image';
    image.src = match[2].replace(/\s/g, '');
    if (/^w\d+$/.test(size)) image.style.width = `${Number(size.slice(1))}px`;
    else if (/^(25|50|75|100)$/.test(size)) image.style.width = `${size}%`;
    fragment.append(image);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex) {
    appendTextWithLinks(text.slice(lastIndex));
    pasteContent.replaceChildren(fragment);
  } else {
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
  const imageDialog = document.createElement('dialog');
  imageDialog.className = 'image-dialog';
  const fullImage = document.createElement('img');
  const closeImage = document.createElement('button');
  closeImage.type = 'button'; closeImage.className = 'image-dialog-close'; closeImage.textContent = 'Close';
  imageDialog.append(fullImage, closeImage); document.body.append(imageDialog);
  const closeDialog = () => imageDialog.close();
  closeImage.addEventListener('click', closeDialog);
  imageDialog.addEventListener('click', event => { if (event.target === imageDialog) closeDialog(); });
  pasteContent.querySelectorAll('.pasted-image').forEach(image => {
    image.tabIndex = 0;
    image.title = 'Open image at full size';
    const openImage = () => { fullImage.src = image.src; fullImage.alt = image.alt; imageDialog.showModal(); };
    image.addEventListener('click', openImage);
    image.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openImage(); } });
  });
}
const textarea = $('#content');
const editor = $('#content-editor');
if (textarea && editor) {
  const contentError = $('#content-error');
  const maxBytes = 128 * 1024;
  const imagePattern = /!\[([^\]]*)\]\((data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+)\)/g;
  let contentErrorVisible = false;
  const serialize = node => [...node.childNodes].map(child => child.nodeType === Node.TEXT_NODE ? child.nodeValue : child.nodeName === 'BR' ? '\n' : child.nodeName === 'IMG' && child.src.startsWith('data:image/') ? `![${child.alt || 'Pasted image'}${child.dataset.size ? `|${child.dataset.size}` : ''}](${child.src})` : serialize(child)).join('');
  const update = () => {
    textarea.value = serialize(editor);
    const bytes = new TextEncoder().encode(textarea.value).length;
    const message = bytes > maxBytes ? 'Please keep your paste under 128 KB.' : !textarea.value.trim() ? 'Give your paste a little text to get started.' : '';
    $('#text-stats').textContent = `${textarea.value.length.toLocaleString()} characters · ${(bytes / 1024).toFixed(1)} / 128 KB`;
    textarea.setCustomValidity(message);
    if (contentError) { contentError.textContent = message; contentError.hidden = !contentErrorVisible || !message; }
    const visualLines = textarea.value.split('\n').length + editor.querySelectorAll('img').length;
    $('#line-gutter').textContent = Array.from({ length: Math.min(visualLines, 2000) }, (_, index) => index + 1).join('\n');
  };
  const insertAtSelection = node => {
    const selection = window.getSelection();
    const range = selection.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : document.createRange();
    if (!editor.contains(range.commonAncestorContainer)) { range.selectNodeContents(editor); range.collapse(false); }
    range.deleteContents(); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range); update();
  };
  const resizeImage = image => {
    editor.querySelectorAll('.image-resize-handle').forEach(handle => handle.remove());
    editor.querySelector('.pasted-image.selected')?.classList.remove('selected');
    if (!image) return;
    image.classList.add('selected');
    const handles = ['nw', 'ne', 'sw', 'se'].map(corner => {
      const handle = document.createElement('span');
      handle.className = `image-resize-handle handle-${corner}`;
      handle.setAttribute('aria-hidden', 'true');
      handle.title = 'Drag to resize image';
      editor.append(handle);
      return { handle, corner };
    });
    const positionHandles = () => {
      const editorBox = editor.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      handles.forEach(({ handle, corner }) => {
        const right = corner.endsWith('e');
        const bottom = corner.endsWith('s');
        handle.style.left = `${(right ? imageBox.right : imageBox.left) - editorBox.left + editor.scrollLeft}px`;
        handle.style.top = `${(bottom ? imageBox.bottom : imageBox.top) - editorBox.top + editor.scrollTop}px`;
      });
    };
    positionHandles();
    handles.forEach(({ handle, corner }) => handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = image.getBoundingClientRect().width;
      const direction = corner.endsWith('e') ? 1 : -1;
      const move = moveEvent => {
        const maxWidth = Math.min(520, editor.clientWidth - 24);
        const width = Math.max(80, Math.min(maxWidth, startWidth + direction * (moveEvent.clientX - startX)));
        image.style.width = `${width}px`;
        image.dataset.size = `w${Math.round(width)}`;
        positionHandles();
        update();
      };
      const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); };
      handle.setPointerCapture?.(event.pointerId); document.addEventListener('pointermove', move); document.addEventListener('pointerup', stop);
    }));
  };
  const imageAsDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => { const image = new Image(); image.addEventListener('load', () => { const scale = Math.min(1, 1600 / image.width, 1600 / image.height); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.82)); }); image.addEventListener('error', reject); image.src = reader.result; });
    reader.addEventListener('error', reject); reader.readAsDataURL(file);
  });
  const clipboardImage = async event => {
    const item = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
    if (item) return item.getAsFile();
    const text = event.clipboardData?.getData('text/plain') || '';
    const match = text.match(/!\[[^\]]*\]\((data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+)\)/);
    if (!match) return null;
    return (await fetch(match[1].replace(/\s/g, ''))).blob();
  };
  const renderValue = value => { editor.replaceChildren(); let lastIndex = 0; for (const match of value.matchAll(imagePattern)) { editor.append(document.createTextNode(value.slice(lastIndex, match.index))); const image = document.createElement('img'); const [alt, size] = match[1].split('|'); image.className = 'pasted-image'; image.alt = alt || 'Pasted image'; image.src = match[2].replace(/\s/g, ''); if (/^w\d+$/.test(size)) { image.dataset.size = size; image.style.width = `${Number(size.slice(1))}px`; } else if (/^(25|50|75|100)$/.test(size)) { image.dataset.size = `w${Math.round(520 * Number(size) / 100)}`; image.style.width = `${Number(size)}%`; } editor.append(image); lastIndex = match.index + match[0].length; } editor.append(document.createTextNode(value.slice(lastIndex))); };
  renderValue(textarea.value);
  editor.addEventListener('input', update);
  editor.addEventListener('paste', async event => {
    const clipboardText = event.clipboardData?.getData('text/plain') || '';
    const hasImage = [...(event.clipboardData?.items || [])].some(item => item.type.startsWith('image/')) || /!\[[^\]]*\]\(data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+\)/.test(clipboardText);
    if (!hasImage) return;
    event.preventDefault();
    try { const dataUrl = await imageAsDataUrl(await clipboardImage(event)); const image = document.createElement('img'); image.className = 'pasted-image'; image.alt = 'Pasted image'; image.src = dataUrl; image.addEventListener('load', () => { const width = Math.min(image.naturalWidth, 520); image.style.width = `${width}px`; image.dataset.size = `w${width}`; update(); resizeImage(image); }, { once: true }); insertAtSelection(image); resizeImage(image); if (new TextEncoder().encode(textarea.value).length > maxBytes) { image.remove(); update(); toast('That image would make the paste larger than 128 KB.'); } } catch { toast('That image could not be pasted.'); }
  });
  editor.addEventListener('click', event => resizeImage(event.target.closest('img')));
  editor.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') $('#paste-form').requestSubmit(); });
  $('#paste-form').addEventListener('submit', event => { update(); if (!textarea.value.trim() || textarea.validationMessage) { event.preventDefault(); contentErrorVisible = true; update(); return; } $('#create-button').disabled = true; $('#create-button').textContent = 'Creating paste…'; });
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
      : 'Expired — content removed';
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
