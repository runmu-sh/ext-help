/**
 * Where a session's help pages come from. Three dialects, picked per session:
 *
 *  - `client-help`: GMCP `Client.Help.Get` / `Client.Help.Search` with a `req` number, answered by
 *    `Client.Help.Page` / `Client.Help.Results` carrying the same `req` (README → For game authors).
 *  - `evennia`: Evennia's webclient help over GMCP: `Help.View` / `Help.Search` as `{ seq, data: { query } }`,
 *    answered by `Core.Res [result, seq, ok]`. Bodies use pipe colour codes.
 *  - `text`: send `help <query>` and capture what the game prints.
 *
 * `auto` (the default) uses what the game has sent so far, then MSSP, then asks.
 */
import type { Mu } from '@muclient/sdk';
import type { Dialect, HelpPage, Markup } from './types';
import type { Loader, Shown } from './store';

export const TIMEOUT_MS = 8000;
const PROBE_MS = 2500;

/** A random positive 31-bit number: request ids must not collide across the player's devices and other extensions. */
export const rid = () => 1 + Math.floor(Math.random() * 0x7ffffffe);

export interface Settings { source(sid: string): string; command(sid: string): string }

export class Sources {
  private known = new Map<string, Dialect>();
  private probing = new Map<string, Promise<Dialect>>();
  /** Requests this client is waiting for, so their answers are not taken for pushed pages. */
  readonly pending = new Set<number>();

  constructor(private mu: Mu, private settings: Settings) {}

  dialect(sid: string): Dialect | null {
    const forced = this.settings.source(sid);
    if (forced === 'client-help' || forced === 'evennia' || forced === 'text') return forced;
    return this.known.get(sid) ?? this.seen(sid);
  }
  /** The game showed which dialect it speaks (a pushed page). */
  learn(sid: string, d: Dialect) { if (!this.known.has(sid) || this.known.get(sid) === 'text') this.known.set(sid, d); }
  forget(sid: string) { this.known.delete(sid); this.probing.delete(sid); }

  private seen(sid: string): Dialect | null {
    const g = this.mu.gmcp;
    // (`supported` reflects what clients declared, ours included, so it says nothing about the game.)
    if (g.seen('Client.Help', sid)) return 'client-help';
    if (g.seen('Help.View', sid)) return 'evennia';
    return null;
  }

  /** The dialect, asking the game when nothing has told us yet. */
  async resolve(sid: string): Promise<Dialect> {
    const d = this.dialect(sid);
    if (d) return d;
    const running = this.probing.get(sid);
    if (running) return running;
    const p = this.probe(sid).then((x) => { this.known.set(sid, x); this.probing.delete(sid); return x; });
    this.probing.set(sid, p);
    return p;
  }

  private async probe(sid: string): Promise<Dialect> {
    if (!this.mu.gmcp.negotiated(sid)) return 'text';
    const codebase = String(this.mu.mssp(sid)?.CODEBASE ?? '');
    const order: Array<Exclude<Dialect, 'text'>> = /evennia/i.test(codebase) ? ['evennia', 'client-help'] : ['client-help', 'evennia'];
    for (const d of order) {
      try { await this.ask(sid, d, 'view', '', PROBE_MS); return d; } catch { /* next */ }
    }
    return 'text';
  }

  /** A loader for the session's store. */
  loader(sid: string): Loader {
    return {
      get: async (q) => this.load(sid, 'view', q),
      search: async (q) => this.load(sid, 'search', q),
    };
  }

  async canSearch(sid: string) { return (await this.resolve(sid)) !== 'text'; }

  private async load(sid: string, what: 'view' | 'search', q: string): Promise<Shown> {
    const d = await this.resolve(sid);
    if (d === 'text') {
      if (what === 'search') throw new Error("this game's help has no search");
      return this.text(sid, q);
    }
    return this.ask(sid, d, what, q, TIMEOUT_MS);
  }

  private async ask(sid: string, d: Exclude<Dialect, 'text'>, what: 'view' | 'search', query: string, timeoutMs: number): Promise<Shown> {
    const n = rid();
    this.pending.add(n);
    try {
      if (d === 'evennia') {
        const res = await this.mu.gmcp.request('Help.' + (what === 'view' ? 'View' : 'Search'), { seq: n, data: { query } }, {
          sid, expect: 'Core.Res', key: `help.${n}`, timeoutMs,
          match: (x: unknown) => Array.isArray(x) && x[1] === n,
        }) as unknown as [unknown, number, boolean];
        if (res[2] === false) throw new Error(typeof res[0] === 'string' ? res[0] : 'the game refused');
        return { page: checkPage(res[0]), markup: 'pipe' };
      }
      const res = await this.mu.gmcp.request('Client.Help.' + (what === 'view' ? 'Get' : 'Search'), { query, req: n }, {
        sid, expect: what === 'view' ? 'Client.Help.Page' : 'Client.Help.Results', key: `help.${n}`, timeoutMs,
        match: (x: unknown) => !!x && typeof x === 'object' && (x as { req?: unknown }).req === n,
      }) as unknown as Record<string, unknown>;
      if (typeof res.error === 'string') throw new Error(res.error);
      return { page: checkPage(res), markup: markupOf(res) };
    } finally {
      // Late duplicates of the answer (another device asked too) are still ours for a moment.
      setTimeout(() => this.pending.delete(n), 2000);
    }
  }

  /** The text fallback: send the help command unechoed, capture to the next prompt (or a quiet second), gag it. */
  private async text(sid: string, q: string): Promise<Shown> {
    const verb = (this.settings.command(sid) || 'help').trim();
    const cmd = q ? `${verb} ${q}` : verb;
    let lines: string[];
    try {
      const got = await this.mu.sessions.request(cmd, {
        sid, raw: true, gag: true, timeoutMs: 1500,
        until: (l) => (l.kind === 'prompt' ? 'done' : 'more'),
      });
      lines = (got ?? []).filter((l) => l.kind !== 'prompt' && l.kind !== 'echo').map((l) => l.text);
    } catch (e) {
      const partial = (e as { partial?: Array<{ text: string; kind: string }> })?.partial;
      if (!partial) throw e;
      lines = partial.filter((l) => l.kind !== 'prompt' && l.kind !== 'echo').map((l) => l.text);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) throw new Error('the game sent nothing');
    return { page: { kind: 'text', query: q, lines }, markup: 'text' };
  }

  /** Tell the game whether `help` should go to the panel (it records it; text may still print). */
  prefs(sid: string, panel: boolean) {
    const d = this.dialect(sid);
    if (d === 'evennia') void this.mu.gmcp.send('Help.Prefs', { seq: rid(), data: { panel } }, sid);
    else if (d === 'client-help') void this.mu.gmcp.send('Client.Help.Prefs', { panel }, sid);
  }
}

const KINDS = new Set(['index', 'category', 'topic', 'section', 'search', 'not_found', 'text']);
/** A page as the game sent it: the shape the panel relies on, or an error. */
export function checkPage(x: unknown): HelpPage {
  const p = x as Record<string, unknown>;
  if (!p || typeof p !== 'object' || !KINDS.has(String(p.kind))) throw new Error('not a help page');
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  switch (p.kind) {
    case 'index': return { kind: 'index', query: '', categories: list(p.categories).filter((c) => c && typeof c === 'object').map((c) => ({ name: String(c.name ?? ''), topics: topics(c.topics) })) };
    case 'category': return { kind: 'category', query: str(p.query), category: String(p.category ?? ''), topics: topics(p.topics) };
    case 'topic': case 'section': {
      const t = p.topic as Record<string, unknown>;
      if (!t || typeof t !== 'object' || typeof t.key !== 'string') throw new Error('a topic page needs topic.key');
      return {
        kind: p.kind, query: str(p.query), section: typeof p.section === 'string' ? p.section : null,
        topic: {
          key: t.key, category: str(t.category), summary: str(t.summary), intro: str(t.intro),
          aliases: list(t.aliases).map(String), links: list(t.links).map(String),
          sections: list(t.sections).filter((s) => s && typeof s === 'object').map((s) => ({ title: String(s.title ?? ''), body: String(s.body ?? ''), syntax: list(s.syntax).map(String) })),
        },
      };
    }
    case 'search': return { kind: 'search', query: String(p.query ?? ''), hits: hits(p.hits) };
    case 'not_found': return { kind: 'not_found', query: String(p.query ?? ''), hits: hits(p.hits), suggestions: list(p.suggestions).filter((s) => s && typeof s === 'object').map((s) => ({ label: String(s.label ?? s.query ?? ''), query: String(s.query ?? '') })) };
    default: return { kind: 'text', query: String(p.query ?? ''), lines: list(p.lines).map(String) };
  }
}
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const topics = (v: unknown) => (Array.isArray(v) ? v : []).filter((t) => t && typeof t === 'object' && t.key != null).map((t) => ({ key: String(t.key), category: str(t.category), summary: str(t.summary) }));
const hits = (v: unknown) => (Array.isArray(v) ? v : []).filter((h) => h && typeof h === 'object' && h.query != null).map((h) => ({ query: String(h.query), key: str(h.key), category: str(h.category), section: str(h.section) ?? null, snippet: str(h.snippet) }));
/** `Client.Help` pages are plain text by default; a game that sends pipe codes says `"markup": "pipe"`. */
export const markupOf = (p: Record<string, unknown>): Markup => (p?.markup === 'pipe' ? 'pipe' : 'plain');
