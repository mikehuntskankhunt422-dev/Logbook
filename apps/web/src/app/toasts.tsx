import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const Ctx = createContext<(message: string, action?: Toast['action'], ms?: number) => void>(() => {});

let next = 1;
const TOAST_EVENT = 'logbook:toast';

interface Announcement {
  message: string;
  action?: Toast['action'];
  ms?: number;
}

/**
 * Shows a toast from code outside React components (the desktop app's link handling and update
 * offers), for `ms` milliseconds (5 s by default).
 */
export function announce(message: string, action?: Toast['action'], ms?: number): void {
  window.dispatchEvent(new CustomEvent<Announcement>(TOAST_EVENT, { detail: { message, action, ms } }));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, action?: Toast['action'], ms = 5000) => {
      const id = next++;
      setToasts((t) => [...t.slice(-2), { id, message, action }]);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const { message, action, ms } = (e as CustomEvent<Announcement>).detail;
      push(message, action, ms);
    };
    window.addEventListener(TOAST_EVENT, onAnnounce);
    return () => window.removeEventListener(TOAST_EVENT, onAnnounce);
  }, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
