(() => {
  let theme;
  try { theme = localStorage.getItem('folio-theme'); } catch { /* Storage can be disabled. */ }
  document.documentElement.dataset.theme = ['light', 'dark'].includes(theme) ? theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();
