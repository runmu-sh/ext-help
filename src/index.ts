/**
 * Help: the game's help in its own panel, with search, sections, cross-references, history, F1, the ☰ menu,
 * `?topic` in the Ctrl+K palette and "Look up in Help" on any word in the terminal.
 *
 * Pages come over GMCP (`Client.Help`, or Evennia's `Help.View` / `Help.Search`), or from the game's `help`
 * command as text when it has neither. Typed `help …` goes to the panel while "Help in its own panel" is on.
 */
import { defineExtension, type Mu } from '@muclient/sdk';
import { HelpStore, norm, type Loader, type Shown } from './store';
import { Sources, checkPage, markupOf } from './source';
import { mountPanel, snapshot, restore } from './panel';
import { CSS } from './css';
import type { Dialect, HelpApi, HelpPage, HelpSource, Markup } from './types';

export type { HelpApi, HelpPage, HelpSource, Dialect, Markup } from './types';

const PANEL = 'help';
/** `help`, `help <topic>`, `help category <name>`, `helpsearch <words>` (the verb is configurable). */
export function parseHelp(text: string, verb = 'help'): { what: 'view' | 'search'; query: string } | null {
  const t = text.trim();
  const v = (verb || 'help').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const s = new RegExp(`^${v}search(?:\\s+(.+))?$`, 'i').exec(t);
  if (s) return { what: 'search', query: norm(s[1] ?? '') };
  const m = new RegExp(`^${v}(?:\\s+(.+))?$`, 'i').exec(t);
  if (!m) return null;
  const q = norm(m[1] ?? '');
  // Switches (`help/add`, `help -x`) are the game's business, not a topic.
  if (/^[/-]/.test(q)) return null;
  return { what: 'view', query: q };
}

export default defineExtension({
  async activate(ctx) {
    const mu: Mu = ctx.mu;

    mu.settings.define({
      title: 'Help',
      items: [
        { key: 'inPanel', label: 'Help in its own panel', default: true, kind: 'toggle',
          hint: 'Typed help commands open here instead of printing in the terminal. Always off in screen reader mode.' },
        { key: 'source', label: 'Help source', default: 'auto', kind: 'select', scope: 'world',
          options: [{ value: 'auto', label: 'automatic' }, { value: 'client-help', label: 'GMCP Client.Help' }, { value: 'evennia', label: 'GMCP Help (Evennia)' }, { value: 'text', label: 'text (the help command)' }],
          hint: 'Where pages come from. Automatic uses what the game supports.' },
        { key: 'command', label: 'Help command', default: 'help', kind: 'text', scope: 'world',
          hint: 'The verb this game uses for help (help, @help, info …). With “search” after it, it searches.' },
      ],
      sections: [{ page: 'text', title: 'Help', keys: ['inPanel'] }],
    });

    const setting = <T>(key: string, sid?: string) => mu.settings.get<T>(key, sid ? { sid } : undefined);
    const verbOf = (sid: string) => String(setting<string>('command', sid) || 'help');
    const screenReader = () => mu.prefs.get('a11y.screenReader') === true;
    /** "Help in its own panel", and never under a screen reader (help stays in the terminal there). */
    const inPanel = (sid?: string) => setting<boolean>('inPanel', sid) !== false && !screenReader();

    const sources = new Sources(mu, { source: (sid) => String(setting<string>('source', sid) || 'auto'), command: verbOf });
    const custom = new Map<string, HelpSource>();
    const stores = new Map<string, HelpStore>();
    const loaderOf = (sid: string): Loader | null => {
      const c = custom.get(sid);
      if (c) {
        const markup: Markup = c.markup ?? 'plain';
        return {
          get: async (q) => ({ page: checkPage(await c.get(q)), markup }),
          ...(c.search ? { search: async (q: string) => ({ page: checkPage(await c.search!(q)), markup }) } : {}),
        };
      }
      const s = mu.sessions.list().find((x) => x.id === sid);
      if (!s || s.state !== 'connected') return null;
      return sources.loader(sid);
    };
    const storeOf = (sid: string) => {
      let st = stores.get(sid);
      if (!st) { st = new HelpStore(() => loaderOf(sid)); stores.set(sid, st); }
      return st;
    };
    const active = () => mu.sessions.active()?.id ?? null;
    const canSearch = async (sid: string) => {
      const c = custom.get(sid);
      if (c) return !!c.search;
      return sources.canSearch(sid);
    };

    // The game's help preference: sent once the dialect is known and whenever the effective value changes.
    const prefSent = new Map<string, boolean>();
    const syncPrefs = (sid: string) => {
      const d = sources.dialect(sid);
      if (!d || d === 'text') return;
      const v = inPanel(sid);
      if (prefSent.get(sid) === v) return;
      prefSent.set(sid, v);
      sources.prefs(sid, v);
    };
    const syncAll = () => { for (const s of mu.sessions.list()) if (s.state === 'connected') syncPrefs(s.id); };
    mu.settings.watch('inPanel', syncAll);
    mu.prefs.watch('a11y.screenReader', syncAll);

    mu.sessions.each((s) => {
      storeOf(s.id);
      return () => { stores.delete(s.id); custom.delete(s.id); prefSent.delete(s.id); sources.forget(s.id); };
    });
    mu.sessions.on('state', (s) => {
      if (s.state === 'connected') { sources.forget(s.id); prefSent.delete(s.id); syncPrefs(s.id); }
    });

    const openPanel = (sid: string, focus = true) => mu.panels.open(PANEL, {}, { sid, focus });
    const open = async (query = '', sid?: string | null) => {
      const s = sid ?? active();
      if (!s) return;
      openPanel(s);
      await storeOf(s).open(query);
    };
    const show = (page: HelpPage, sid: string, markup: Markup, openIt: boolean) => {
      storeOf(sid).push({ page, markup });
      if (openIt) openPanel(sid, false);
    };

    // ─── GMCP: pages the game pushes ───────────────────────────────────────────
    const pushed = (sid: string, data: unknown, markup: Markup, d: Dialect, openIt: boolean) => {
      sources.learn(sid, d);
      syncPrefs(sid);
      let page: HelpPage;
      try { page = checkPage(data); } catch { return; }
      show(page, sid, markup, openIt);
    };
    const ours = (data: unknown) => {
      const req = (data as { req?: unknown })?.req;
      return typeof req === 'number' && sources.pending.has(req);
    };
    // Client.Help: an unsolicited page is the game routing a typed `help` to the panel, so it opens.
    mu.gmcp.on('Client.Help.Page', (data, m) => { if (!m.replay && !ours(data)) pushed(m.sid, data, markupOf(data as Record<string, unknown>), 'client-help', inPanel(m.sid)); });
    mu.gmcp.on('Client.Help.Results', (data, m) => { if (!m.replay && !ours(data)) pushed(m.sid, data, markupOf(data as Record<string, unknown>), 'client-help', inPanel(m.sid)); });
    // Evennia prints the text page as well, so its push only updates the panel, never opens it.
    mu.gmcp.on('Help.View', (data, m) => { if (!m.replay) pushed(m.sid, data, 'pipe', 'evennia', false); });

    // ─── typed `help …` goes to the panel ──────────────────────────────────────
    mu.input.stage({
      id: 'help.route', phase: 'guard', order: 50,
      run(cmd, c) {
        if (!inPanel(c.sid)) return;
        const hit = parseHelp(cmd.text, verbOf(c.sid));
        if (!hit || (hit.what === 'search' && !hit.query)) return;
        cmd.swallow();
        openPanel(c.sid);
        const st = storeOf(c.sid);
        if (hit.what === 'search') void st.search(hit.query);
        else void st.open(hit.query);
      },
    });

    mu.commands.register({ id: 'help.open', title: 'Open help', keys: ['F1'], group: 'Help', when: 'session', run: (arg) => open(typeof arg === 'string' ? arg : '') });
    mu.commands.register({
      id: 'help.lookup', title: 'Look up a topic', group: 'Help', when: 'session',
      run: async (arg) => {
        const q = typeof arg === 'string' ? arg : await mu.ui.prompt({ title: 'Help topic', placeholder: 'topic or words' });
        if (q != null) await open(q);
      },
    });
    mu.menus.add({ id: 'help.menu', slot: 'main', section: 'app', order: 15, title: 'Help', command: 'help.open', when: 'session' });
    mu.menus.context({
      id: 'help.word', target: 'word', title: (t) => `Look up “${t.kind === 'word' ? t.word : ''}” in Help`,
      when: (t) => t.kind === 'word' && /\w/.test(t.word),
      run: (t) => { if (t.kind === 'word') void open(t.word.replace(/^\W+|\W+$/g, ''), t.sid); },
    });
    mu.menus.context({
      id: 'help.selection', target: 'selection', title: 'Look up in Help',
      when: (t) => t.kind === 'selection' && t.text.trim().length > 0 && t.text.length <= 60,
      run: (t) => { if (t.kind === 'selection') void open(norm(t.text), t.sid); },
    });

    // `?topic` in Ctrl+K: the index's topics, filtered as you type.
    mu.palette.provide({
      mode: 'help', prefix: '?', title: 'Help topics',
      async items(query, { sid }) {
        const s = sid ?? active();
        if (!s) return [];
        const st = storeOf(s);
        let idx: Shown | undefined = st.cached('');
        if (!idx) { const l = loaderOf(s); if (l) { try { idx = await l.get(''); st.remember('', idx); } catch { /* none */ } } }
        const q = norm(query).toLowerCase();
        const list = idx?.page.kind === 'index' ? idx.page.categories.flatMap((c) => c.topics.map((t) => ({ ...t, category: t.category ?? c.name }))) : [];
        const items = list.filter((t) => !q || t.key.toLowerCase().includes(q) || (t.summary ?? '').toLowerCase().includes(q))
          .sort((a, b) => Number(!a.key.toLowerCase().startsWith(q)) - Number(!b.key.toLowerCase().startsWith(q)))
          .slice(0, 50)
          .map((t) => ({ id: `help:${t.key}`, label: t.key, hint: t.summary ?? t.category, keywords: [t.category ?? ''], run: () => { void open(t.key, s); } }));
        if (q) items.push({ id: `help:?${q}`, label: `help ${norm(query)}`, hint: 'Open in Help', keywords: [], run: () => { void open(norm(query), s); } });
        return items;
      },
    });

    mu.ui.style(CSS);
    mu.panels.register({
      id: PANEL, title: 'Help', perSession: true, order: 60, defaultPosition: 'right-top',
      mount: (el, p) => mountPanel(mu, { store: (sid) => storeOf(sid), canSearch, site: (sid) => mu.sessions.meta(sid)?.links?.help ?? null }, el, p.sid),
      snapshot: (el) => snapshot(el),
      restore: (el, v) => restore(el, v),
    });

    const api = (track: (d: () => void) => () => void): HelpApi => ({
      open: (q, sid) => open(q ?? '', sid),
      show: (page, sid, o) => { const s = sid ?? active(); if (s) show(checkPage(page), s, o?.markup ?? 'plain', o?.open !== false); },
      page: (sid) => { const s = sid ?? active(); return (s && stores.get(s)?.shown?.page) || null; },
      provideSource: (sid, src) => {
        custom.set(sid, src);
        return track(() => { if (custom.get(sid) === src) custom.delete(sid); });
      },
      dialect: (sid) => { const s = sid ?? active(); if (!s) return null; return custom.has(s) ? 'custom' : sources.dialect(s); },
    });
    ctx.exports((caller) => api(caller.track));
  },
});
