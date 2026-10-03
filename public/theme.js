(() => {
  const root = document.documentElement;
  const setTheme = theme => {
    const next = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('folio-theme', next);
    } catch { /* Storage can be disabled. */ }
  };

  let theme = null;
  try {
    if (typeof localStorage !== 'undefined') theme = localStorage.getItem('folio-theme');
  } catch { /* Storage can be disabled. */ }

  const hasMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const prefersDark = hasMatchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(['light', 'dark'].includes(theme) ? theme : (prefersDark ? 'dark' : 'light'));
})();
