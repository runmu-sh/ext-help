/**
 * Help body markup → a small block model the panel renders (and the tests read without a DOM).
 *
 *  - `pipe`: pipe colour codes (`|w…|n`, `|r`, `|[b`, `|123`, `|#ff8800`, `|/` …). A highlighted run reading
 *    `help <topic>` becomes a cross-reference; any other highlighted run is a highlight. `||` is a literal pipe.
 *  - `plain`: plain text where `\u0002topic\u0003` marks a cross-reference.
 *  - `text`: lines the game printed; `help <word>` in them becomes a cross-reference.
 *
 * Paragraphs are separated by blank lines and reflowed (their lines joined) unless a line is indented or a whole
 * line is one highlighted run (a syntax line), in which case the paragraph keeps its lines.
 */
import type { Markup } from './types';

export type Run = { t: 'text'; text: string } | { t: 'hl'; text: string } | { t: 'ref'; text: string; query: string };
export type Block = { kind: 'p'; runs: Run[] } | { kind: 'lines'; lines: Run[][] };

const COLOUR = /^\|(?:\[?[rgybmcwxRGYBMCWX]|\[?\d{3}|\[?=[a-z]|\[?#[0-9a-fA-F]{6})/;
const STRIP = /^\|[*^uUhHiIsS>]/;
const REF_HELP = /^help(?:\s+([^<>[\]{}|]+?))?\s*$/i;

/** Parse one line of pipe markup into runs. */
export function pipeRuns(line: string): Run[] {
  const runs: Run[] = [];
  let buf = '', hl = false;
  const flush = () => {
    if (!buf) return;
    if (hl) runs.push(asRef(buf) ?? { t: 'hl', text: buf });
    else runs.push({ t: 'text', text: buf });
    buf = '';
  };
  for (let i = 0; i < line.length;) {
    if (line[i] !== '|') { buf += line[i++]; continue; }
    const rest = line.slice(i);
    if (rest.startsWith('||')) { buf += '|'; i += 2; continue; }
    if (/^\|n/.test(rest)) { flush(); hl = false; i += 2; continue; }
    if (/^\|\//.test(rest)) { buf += ' '; i += 2; continue; }
    if (/^\|-/.test(rest)) { buf += '    '; i += 2; continue; }
    if (/^\|_/.test(rest)) { buf += ' '; i += 2; continue; }
    const c = COLOUR.exec(rest);
    if (c) { flush(); hl = true; i += c[0].length; continue; }
    const s = STRIP.exec(rest);
    if (s) { i += s[0].length; continue; }
    buf += '|'; i++;
  }
  flush();
  return merge(runs);
}

function asRef(text: string): Run | null {
  const m = REF_HELP.exec(text.trim());
  if (!m) return null;
  return { t: 'ref', text: text.trim(), query: (m[1] ?? '').trim() };
}

/** Parse plain markup (\u0002ref\u0003). */
export function plainRuns(line: string): Run[] {
  const runs: Run[] = [];
  const re = /\u0002([^\u0002\u0003]*)\u0003/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > at) runs.push({ t: 'text', text: line.slice(at, m.index) });
    const q = m[1].replace(/^help\s+/i, '').trim();
    runs.push({ t: 'ref', text: m[1].trim(), query: q });
    at = m.index + m[0].length;
  }
  if (at < line.length) runs.push({ t: 'text', text: line.slice(at) });
  return merge(runs);
}

/** `help <topic>` in printed text. One word, or `word/section`; `<…>` placeholders are not references. */
export const TEXT_REF = /\bhelp ([A-Za-z@+][\w@+'-]*(?:\/[\w-]+)?)/g;
export function textRuns(line: string): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const m of line.matchAll(TEXT_REF)) {
    const q = m[1].replace(/['-]+$/, '');
    const end = m.index! + 5 + q.length;
    if (m.index! > at) runs.push({ t: 'text', text: line.slice(at, m.index) });
    runs.push({ t: 'ref', text: line.slice(m.index!, end), query: q });
    at = end;
  }
  if (at < line.length) runs.push({ t: 'text', text: line.slice(at) });
  return merge(runs);
}

function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.t === r.t && r.t !== 'ref') last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

const runsOf = (markup: Markup) => (markup === 'pipe' ? pipeRuns : markup === 'text' ? textRuns : plainRuns);

/** A whole line that is one highlighted (or reference) run: a syntax line. */
const wholeHl = (runs: Run[]) => runs.filter((r) => r.t !== 'text' || r.text.trim()).length === 1 && runs.some((r) => r.t !== 'text');

/** A body into blocks. `text` markup keeps every line as it is. */
export function blocks(body: string, markup: Markup): Block[] {
  const parse = runsOf(markup);
  const src = String(body ?? '').replace(/\r\n?/g, '\n');
  if (markup === 'text') return src ? [{ kind: 'lines', lines: src.split('\n').map(parse) }] : [];
  const out: Block[] = [];
  for (const para of src.split(/\n[ \t]*\n/)) {
    const lines = para.split('\n').filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
    if (!lines.length || !lines.some((l) => l.trim())) continue;
    const parsed = lines.map(parse);
    const keep = lines.some((l) => /^[ \t]/.test(l)) || parsed.some(wholeHl);
    if (keep) out.push({ kind: 'lines', lines: parsed });
    else out.push({ kind: 'p', runs: merge(parsed.flatMap((r, i) => (i ? [{ t: 'text', text: ' ' } as Run, ...r] : r))) });
  }
  return out;
}

/** The text of a body without markup (palette hints, search snippets). */
export function plainText(s: string, markup: Markup): string {
  return blocks(s, markup).map((b) => (b.kind === 'p' ? b.runs : b.lines.flat()).map((r) => r.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
}

/** `help-sec-<slug>`: a section's element id. */
export const slug = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
