import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'entry'; id: string }
  | { name: 'new'; date?: string }
  | { name: 'calendar'; month?: string }
  | { name: 'memories' }
  | { name: 'search'; tag?: string }
  | { name: 'book' }
  | { name: 'order'; id: string; cancelled?: boolean }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(query);
  const seg = path.split('/').filter(Boolean);
  switch (seg[0]) {
    case 'entry':
      return seg[1] ? { name: 'entry', id: decodeURIComponent(seg[1]) } : { name: 'home' };
    case 'new':
      return { name: 'new', date: q.get('date') ?? undefined };
    case 'calendar':
      return { name: 'calendar', month: q.get('month') ?? undefined };
    case 'memories':
      return { name: 'memories' };
    case 'search':
      return { name: 'search', tag: q.get('tag') ?? undefined };
    case 'book':
      return { name: 'book' };
    case 'order':
      // Stripe sends the customer back here (?cancelled=1 when they left the payment page).
      return seg[1] ? { name: 'order', id: decodeURIComponent(seg[1]), ...(q.get('cancelled') ? { cancelled: true } : {}) } : { name: 'book' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'entry':
      return `#/entry/${encodeURIComponent(route.id)}`;
    case 'new':
      return route.date ? `#/new?date=${route.date}` : '#/new';
    case 'calendar':
      return route.month ? `#/calendar?month=${route.month}` : '#/calendar';
    case 'memories':
      return '#/memories';
    case 'search':
      return route.tag ? `#/search?tag=${encodeURIComponent(route.tag)}` : '#/search';
    case 'book':
      return '#/book';
    case 'order':
      return `#/order/${encodeURIComponent(route.id)}${route.cancelled ? '?cancelled=1' : ''}`;
    case 'settings':
      return '#/settings';
  }
}

let lastWasReplace = false;

/** True when the most recent route change was a silent URL update (e.g. a new entry getting its id). */
export function consumeReplaceFlag(): boolean {
  const v = lastWasReplace;
  lastWasReplace = false;
  return v;
}

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const h = href(route);
  lastWasReplace = Boolean(opts.replace);
  if (opts.replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return route;
}
