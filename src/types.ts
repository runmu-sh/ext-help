/**
 * The help page model and the exported API of the Help extension (`ctx.api('help')`).
 * A game sends pages in these shapes over GMCP (see README → For game authors).
 */

/** A topic as listed on the index and category pages. */
export interface TopicRef { key: string; category?: string; summary?: string }

/** One section of a topic. `body` uses the dialect's markup (see README). */
export interface HelpSection { title: string; body: string; syntax?: string[] }

export interface HelpTopic {
  key: string;
  category?: string;
  summary?: string;
  aliases?: string[];
  intro?: string;
  sections?: HelpSection[];
  /** Keys of related topics, shown as "See also". */
  links?: string[];
}

/** A search hit: `query` is what opening it asks for (`topic` or `topic/section`). */
export interface HelpHit { query: string; key?: string; category?: string; section?: string | null; snippet?: string }

export type HelpPage =
  | { kind: 'index'; query?: string; categories: Array<{ name: string; topics: TopicRef[] }> }
  | { kind: 'category'; query?: string; category: string; topics: TopicRef[] }
  | { kind: 'topic' | 'section'; query?: string; topic: HelpTopic; section?: string | null }
  | { kind: 'search'; query: string; hits: HelpHit[] }
  | { kind: 'not_found'; query: string; hits?: HelpHit[]; suggestions?: Array<{ label: string; query: string }> }
  /** The plain-text fallback: the lines the game printed for `help <query>`. */
  | { kind: 'text'; query: string; lines: string[] };

/** How a page's bodies are marked up: `pipe` (`|w…|n` codes), `plain` (\u0002ref\u0003 marks), `text` (printed lines). */
export type Markup = 'pipe' | 'plain' | 'text';

/** Where a session's help comes from. */
export type Dialect = 'client-help' | 'evennia' | 'text';

/** A page source another extension can provide for a session (`api.provideSource`). */
export interface HelpSource {
  get(query: string): Promise<HelpPage>;
  /** Omit when the source cannot search; the panel then only opens topics. */
  search?(query: string): Promise<HelpPage>;
  /** The markup of page bodies (default `plain`). */
  markup?: Markup;
}

/** What `ctx.api('help')` returns. */
export interface HelpApi {
  /** Open the panel on a query (`""` is the index) for a session (default: the active one). */
  open(query?: string, sid?: string): Promise<void>;
  /** Show a page in a session's panel, as if the game had sent it, and open the panel. */
  show(page: HelpPage, sid?: string, opts?: { markup?: Markup; open?: boolean }): void;
  /** The page a session's panel shows now. */
  page(sid?: string): HelpPage | null;
  /** Replace where a session's help comes from. Dispose to go back to the game's. */
  provideSource(sid: string, source: HelpSource): () => void;
  /** The dialect in use for a session, once known. */
  dialect(sid?: string): Dialect | 'custom' | null;
}
