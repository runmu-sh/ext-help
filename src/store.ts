/**
 * One session's help state: the page shown, the history of queries opened (back / forward), an LRU cache of the
 * last 60 pages, and the loading and error state. Plain data and callbacks, no DOM, so it is tested headless.
 */
import type { HelpPage, Markup } from './types';

export const CACHE_MAX = 60;
export const HISTORY_MAX = 100;

export interface Shown { page: HelpPage; markup: Markup }
export interface Loader {
  get(query: string): Promise<Shown>;
  search?(query: string): Promise<Shown>;
}

export class HelpStore {
  /** What the body shows. */
  shown: Shown | null = null;
  /** The opened query the page belongs to (null while search results are shown). */
  query: string | null = null;
  /** The section to scroll to and flash after the next render. */
  focus: string | null = null;
  history: string[] = [];
  at = -1;
  loading = false;
  error: string | null = null;
  /** Panels mounted for this session. */
  mounted = 0;
  private cache = new Map<string, Shown>();
  private ticket = 0;
  private listeners = new Set<() => void>();

  constructor(public loader: () => Loader | null) {}

  watch(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  changed() { for (const f of [...this.listeners]) f(); }

  get canBack() { return this.at > 0; }
  get canForward() { return this.at >= 0 && this.at < this.history.length - 1; }

  cached(query: string) { return this.cache.get(key(query)); }
  remember(query: string, s: Shown) {
    const k = key(query);
    this.cache.delete(k);
    this.cache.set(k, s);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }
  get cacheSize() { return this.cache.size; }
  /** Every cached page (the palette reads topic lists from the index here). */
  pages() { return [...this.cache.values()]; }

  /** Open a query: it becomes the newest history entry (anything forward of the current one is dropped). */
  open(query: string): Promise<void> {
    const q = norm(query);
    if (this.history[this.at] !== q) {
      this.history = this.history.slice(0, this.at + 1);
      this.history.push(q);
      if (this.history.length > HISTORY_MAX) this.history.shift();
      this.at = this.history.length - 1;
    }
    return this.load(q, false);
  }
  back() { if (!this.canBack) return Promise.resolve(); this.at--; return this.load(this.history[this.at], true); }
  forward() { if (!this.canForward) return Promise.resolve(); this.at++; return this.load(this.history[this.at], true); }

  /** Show a page that arrived without being asked for (the game pushed it). It joins the history and the cache. */
  push(s: Shown) {
    const q = norm(queryOf(s.page));
    if (s.page.kind !== 'search') {
      if (this.history[this.at] !== q) { this.history = this.history.slice(0, this.at + 1); this.history.push(q); this.at = this.history.length - 1; }
      this.remember(q, s);
      this.query = q;
    } else this.query = null;
    this.ticket++;
    this.shown = s; this.loading = false; this.error = null; this.focus = sectionOf(s.page);
    this.changed();
  }

  /** Search results replace the page; they are not a history entry. */
  async search(query: string) {
    const l = this.loader();
    const q = norm(query);
    if (!l?.search || !q) return;
    const t = ++this.ticket;
    this.loading = true; this.changed();
    try {
      const s = await l.search(q);
      if (t !== this.ticket) return;
      this.shown = s; this.query = null; this.error = null; this.focus = null;
    } catch (e) {
      if (t !== this.ticket) return;
      this.error = reason(e);
    }
    this.loading = false; this.changed();
  }

  /** Back to the current history entry (the search field was cleared). */
  restore() { const q = this.history[this.at]; if (q !== undefined) void this.load(q, true); }

  private async load(q: string, preferCache: boolean) {
    const t = ++this.ticket;
    const hit = this.cache.get(key(q));
    if (preferCache && hit) { this.settle(t, q, hit); return; }
    const l = this.loader();
    if (!l) { this.fail(t, q, 'not connected'); return; }
    this.loading = true; this.error = null; this.changed();
    try { const s = await l.get(q); this.remember(q, s); this.settle(t, q, s); }
    catch (e) { this.fail(t, q, reason(e)); }
  }
  private settle(t: number, q: string, s: Shown) {
    if (t !== this.ticket) return;
    this.shown = s; this.query = q; this.loading = false; this.error = null; this.focus = sectionOf(s.page);
    this.changed();
  }
  /** A failed request shows the cached page when there is one, otherwise the error. */
  private fail(t: number, q: string, why: string) {
    if (t !== this.ticket) return;
    const hit = this.cache.get(key(q));
    this.loading = false;
    if (hit) { this.shown = hit; this.query = q; this.error = null; this.focus = sectionOf(hit.page); }
    else this.error = why;
    this.changed();
  }
}

export const norm = (q: string) => String(q ?? '').trim().replace(/\s+/g, ' ');
const key = (q: string) => norm(q).toLowerCase();
const reason = (e: unknown) => String((e as Error)?.message ?? e ?? '').trim();
export function queryOf(p: HelpPage): string {
  if (typeof p.query === 'string') return p.query;
  if (p.kind === 'topic' || p.kind === 'section') return p.section ? `${p.topic.key}/${p.section}` : p.topic.key;
  if (p.kind === 'category') return `category ${p.category}`;
  return '';
}
const sectionOf = (p: HelpPage) => ((p.kind === 'topic' || p.kind === 'section') && p.section ? String(p.section) : null);
