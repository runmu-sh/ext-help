/**
 * A help page → DOM. Plain DOM through `mu.ui.h`; the look is in css.ts (theme tokens only).
 * Every link carries `data-help="<query>"`; the panel handles the clicks.
 */
import type { Mu } from '@muclient/sdk';
import type { HelpHit, HelpPage, Markup, TopicRef } from './types';
import { blocks, slug, type Block, type Run } from './markup';

export const COPY = {
  prompt: 'HELP>',
  placeholder: 'Search or type a topic',
  aria: 'Search help',
  back: 'Back', forward: 'Forward', topics: 'Topics',
  loading: 'Loading help',
  empty: 'Search above, or choose Topics for every topic.',
  unavailable: (why?: string | null) => (why ? `Help is unavailable: ${why}` : 'Help is unavailable.'),
  lead: ['Start with ', 'help newbie', '. How to read a syntax line: ', 'help syntax', '.'],
  crumbRoot: 'Help',
  sections: 'Sections',
  seeAlso: 'See also',
  aliases: 'Also',
  matches: (n: number, q: string) => `${n} match${n === 1 ? '' : 'es'} for “${q}”. ${n ? 'Enter opens the first.' : ''}`.trim(),
  notFound: (q: string) => `No help topic matches “${q}”.`,
  didYouMean: 'Did you mean',
  textOnly: "This game's help is plain text.",
} as const;

export function renderPage(mu: Mu, page: HelpPage, markup: Markup, focus: string | null): HTMLElement {
  const h = mu.ui.h;
  const link = (query: string, label: string, title?: string, cls = 'xref') => h('a', { class: `ext-help-${cls}`, href: '#', 'data-help': query, title }, label);
  const crumbs = (...parts: Array<[string, string] | string>) => h('nav', { class: 'ext-help-crumbs', 'aria-label': 'Breadcrumbs' },
    ...parts.flatMap((p, i) => [i ? h('span', { class: 'ext-help-sep', 'aria-hidden': 'true' }, ' / ') : null, typeof p === 'string' ? h('span', null, p) : link(p[1], p[0], undefined, 'crumb')]));
  const runs = (rs: Run[]) => rs.map((r) => (r.t === 'ref' ? link(r.query, r.text, r.query ? `help ${r.query}` : 'help') : r.t === 'hl' ? h('span', { class: 'ext-help-hl' }, r.text) : r.text));
  const body = (bs: Block[]) => bs.map((b) => (b.kind === 'p'
    ? h('p', { class: 'ext-help-p' }, runs(b.runs))
    : h('div', { class: 'ext-help-lines' }, b.lines.map((l) => h('div', { class: 'ext-help-line' }, l.length ? runs(l) : '\u00a0')))));
  const rows = (items: Array<{ query: string; label: string; note?: string }>) => h('ul', { class: 'ext-help-rows' },
    items.map((it) => h('li', { class: 'ext-help-row' }, link(it.query, it.label, undefined, 'key'), it.note ? h('span', { class: 'ext-help-note' }, it.note) : null)));
  const topicRows = (ts: TopicRef[]) => rows(ts.map((t) => ({ query: t.key, label: t.key, note: t.summary })));
  const hitRows = (hs: HelpHit[]) => rows(hs.map((x) => ({ query: x.query, label: x.query, note: x.snippet })));
  const root = h('article', { class: 'ext-help-page', 'data-kind': page.kind });

  switch (page.kind) {
    case 'index': {
      const L = COPY.lead;
      root.append(h('p', { class: 'ext-help-lead' }, L[0], link('newbie', L[1]), L[2], link('syntax', L[3]), L[4]));
      for (const c of page.categories) {
        root.append(h('section', { class: 'ext-help-cat' },
          h('h2', { class: 'ext-help-catname' }, link(`category ${c.name}`, c.name, `All ${c.name} topics`, 'catlink')),
          h('div', { class: 'ext-help-grid' }, c.topics.map((t) => h('button', { type: 'button', class: 'ext-help-topic', 'data-help': t.key, title: t.summary ?? '' }, t.key)))));
      }
      break;
    }
    case 'category':
      root.append(crumbs([COPY.crumbRoot, ''], page.category), h('h1', { class: 'ext-help-title' }, page.category), topicRows(page.topics));
      break;
    case 'topic': case 'section': {
      const t = page.topic;
      const secs = t.sections ?? [];
      const want = (page.section ?? focus ?? '').toLowerCase();
      root.append(
        crumbs([COPY.crumbRoot, ''], ...(t.category ? [[t.category, `category ${t.category}`] as [string, string]] : []), t.key),
        h('h1', { class: 'ext-help-title' }, t.key),
      );
      if (t.summary) root.append(h('p', { class: 'ext-help-summary' }, t.summary));
      if (secs.length >= 4) {
        root.append(h('nav', { class: 'ext-help-toc', 'aria-label': COPY.sections },
          h('span', { class: 'ext-help-label' }, COPY.sections),
          secs.map((s) => h('a', { class: 'ext-help-tocitem', href: `#help-sec-${slug(s.title)}`, 'data-sec': s.title }, s.title))));
      }
      if (t.intro) root.append(...body(blocks(t.intro, markup)));
      for (const s of secs) {
        const on = !!want && s.title.toLowerCase() === want;
        root.append(h('section', { class: 'ext-help-sec', id: `help-sec-${slug(s.title)}`, 'data-sec': s.title },
          s.title ? h('h3', { class: `ext-help-h3${on ? ' ext-help-focus' : ''}` }, on ? h('span', { class: 'ext-help-mark', 'aria-hidden': 'true' }, '▸ ') : null, s.title) : null,
          ...body(blocks(s.body, markup))));
      }
      if (t.links?.length) root.append(h('p', { class: 'ext-help-also' }, h('span', { class: 'ext-help-label' }, COPY.seeAlso), t.links.map((k) => link(k, k, undefined, 'chip'))));
      break;
    }
    case 'search':
      root.append(h('p', { class: 'ext-help-count', role: 'status' }, COPY.matches(page.hits.length, page.query)), hitRows(page.hits));
      break;
    case 'not_found':
      root.append(h('p', { class: 'ext-help-count', role: 'status' }, COPY.notFound(page.query)));
      if (page.suggestions?.length) root.append(h('p', { class: 'ext-help-also' }, h('span', { class: 'ext-help-label' }, COPY.didYouMean), page.suggestions.map((s) => link(s.query, s.label, undefined, 'chip'))));
      if (page.hits?.length) root.append(hitRows(page.hits));
      break;
    case 'text':
      if (page.query) root.append(crumbs([COPY.crumbRoot, ''], page.query));
      root.append(...body(blocks(page.lines.join('\n'), 'text')));
      break;
  }
  return root;
}

/** The first hit of a results page, for Enter. */
export function firstHit(page: HelpPage | undefined | null): string | null {
  if (!page) return null;
  if (page.kind === 'search') return page.hits[0]?.query ?? null;
  if (page.kind === 'not_found') return page.suggestions?.[0]?.query ?? page.hits?.[0]?.query ?? null;
  return null;
}
