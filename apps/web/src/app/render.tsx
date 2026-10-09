import { StrictMode, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { Journal } from '@logbook/core';
import { JournalProvider } from './journal-context.tsx';
import { ToastProvider } from './toasts.tsx';
import { App } from './App.tsx';

/** Renders the app for an open journal. The desktop wraps it to add its folder context. */
export function renderJournal(root: Root, journal: Journal, wrap: (app: ReactNode) => ReactNode = (app) => app): void {
  root.render(
    <StrictMode>
      <ToastProvider>
        <JournalProvider journal={journal}>{wrap(<App />)}</JournalProvider>
      </ToastProvider>
    </StrictMode>,
  );
}
