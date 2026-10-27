/**
 * What the app window's security policy (D104, apps/desktop/src-tauri/tauri.conf.json) blocked,
 * from the very start: said in the console, and kept for the desktop and Android tests, which check
 * that nothing the app itself needs is blocked. main.tsx imports this before anything else.
 */
if (import.meta.env.VITE_PLATFORM !== 'web') {
  const blocked: string[] = [];
  (window as Window & { logbookBlocked?: string[] }).logbookBlocked = blocked;
  document.addEventListener('securitypolicyviolation', (e) => {
    const what = `${e.effectiveDirective} ${e.blockedURI || '(inline)'}`;
    blocked.push(what);
    console.warn(`The window's security policy blocked ${what}.`);
  });
}

export {};
