/**
 * The Help panel: a `HELP>` search field with Back / Forward / Topics, and the page body. One store per session.
 */
import type { Mu } from '@muclient/sdk';
import type { HelpStore } from './store';
import { COPY, firstHit, renderPage } from './render';
import { slug } from './markup';

export const DEBOUNCE_MS = 180;
export const FLASH_MS = 1400;

export interface PanelDeps {
  store(sid: string): HelpStore | null;
  canSearch(sid: string): Promise<boolean>;
  /** The game's help site (MSSP / MCP server info), when it has one. */
  site(sid: string): string | null;
}

export function mountPanel(mu: Mu, deps: PanelDeps, el: HTMLElement, sid: string | null): () => void {
  const h = mu.ui.h, c = mu.ui.css;
  const store = sid ? deps.store(sid) : null;
  const input = h('input', { class: 'ext-help-q', type: 'search', placeholder: COPY.placeholder, 'aria-label': COPY.aria, autocomplete: 'off', spellcheck: 'false', 'data-testid': 'help-input' });
  const cmd = (label: string, testid: string, run: () => void) => h('button', { type: 'button', class: c.cmd, 'data-testid': testid, onclick: run }, label);
  const back = cmd(COPY.back, 'help-back', () => { input.value = ''; void store?.back(); });
  const fwd = cmd(COPY.forward, 'help-forward', () => { input.value = ''; void store?.forward(); });
  const topics = cmd(COPY.topics, 'help-topics', () => { input.value = ''; void store?.open(''); });
  const siteBtn = cmd('', 'help-site', () => { const u = sid && deps.site(sid); if (u) mu.panels.openWeb({ url: u, id: 'help-site', title: 'Help' }, sid!); });
  const err = h('div', { class: 'ext-help-err', role: 'alert', hidden: true, 'data-testid': 'help-error' });
  const hint = h('div', { class: 'ext-help-hint', hidden: true }, COPY.textOnly);
  const body = h('div', { class: 'ext-help-body', tabindex: '-1', 'aria-live': 'polite', 'data-testid': 'help-body' });
  el.replaceChildren(h('div', { class: 'ext-help', 'data-testid': 'help-panel' },
    h('div', { class: 'ext-help-head' }, h('span', { class: 'ext-help-prompt', 'aria-hidden': 'true' }, COPY.prompt), input,
      h('div', { class: 'ext-help-cmds' }, back, fwd, topics, siteBtn)),
    err, hint, body));
  const offRegion = mu.a11y.region(el, { name: 'Help', key: 'help' });

  let searchable = true;
  if (sid) void deps.canSearch(sid).then((v) => { searchable = v; hint.hidden = v; }).catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined, flashTimer: ReturnType<typeof setTimeout> | undefined;
  let drawn: unknown = null;
  const calm = () => !!mu.prefs.get('effects.calm');

  const reveal = (title: string) => {
    const sec = body.querySelector<HTMLElement>(`#help-sec-${CSS.escape(slug(title))}`);
    if (!sec) return;
    sec.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
    if (calm()) return;
    const head = sec.querySelector<HTMLElement>('.ext-help-h3') ?? sec;
    head.classList.remove('ext-help-flash');
    void head.offsetWidth;
    head.classList.add('ext-help-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => head.classList.remove('ext-help-flash'), FLASH_MS);
  };

  const draw = () => {
    back.disabled = !store?.canBack;
    fwd.disabled = !store?.canForward;
    const site = sid ? deps.site(sid) : null;
    siteBtn.hidden = !site;
    if (site) { try { siteBtn.textContent = `${new URL(site).host} help`; } catch { siteBtn.hidden = true; } }
    err.hidden = !store?.error;
    err.textContent = store?.error ? COPY.unavailable(store.error) : '';
    const shown = store?.shown;
    body.setAttribute('aria-busy', store?.loading ? 'true' : 'false');
    if (!shown) {
      const k = `empty:${!!store?.loading}`;
      if (drawn !== k) {
        body.replaceChildren(h('p', { class: 'ext-help-empty', 'data-testid': 'help-empty' }, store?.loading ? COPY.loading : COPY.empty));
        drawn = k;
      }
      return;
    }
    if (drawn === shown) return;
    drawn = shown;
    body.replaceChildren(renderPage(mu, shown.page, shown.markup, store!.focus));
    const f = store!.focus;
    if (f) { store!.focus = null; requestAnimationFrame(() => reveal(f)); } else body.scrollTop = 0;
  };

  const go = (q: string) => { clearTimeout(timer); input.value = ''; void store?.open(q); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { store?.restore(); return; }
    if (!searchable) return;
    timer = setTimeout(() => { void store?.search(q); }, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      const shown = store?.shown?.page;
      const first = shown && shown.kind === 'search' && shown.query.toLowerCase() === q.toLowerCase() ? firstHit(shown) : null;
      go(first ?? q);
    } else if (e.key === 'Escape' && input.value) {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(timer); input.value = ''; store?.restore();
    }
  });
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const toc = t.closest<HTMLElement>('.ext-help-tocitem');
    if (toc) { e.preventDefault(); reveal(toc.dataset.sec ?? ''); return; }
    const a = t.closest<HTMLElement>('[data-help]');
    if (a) { e.preventDefault(); go(a.dataset.help ?? ''); }
  });

  const off = store?.watch(draw);
  if (store) {
    store.mounted++;
    if (!store.shown && !store.loading && store.at < 0) void store.open('');
  }
  draw();
  return () => {
    clearTimeout(timer); clearTimeout(flashTimer);
    off?.(); offRegion();
    if (store) store.mounted--;
  };
}

/** The search field's text, for hot reload. */
export const snapshot = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.ext-help-q')?.value || undefined;
export const restore = (el: HTMLElement, v: unknown) => { const i = el.querySelector<HTMLInputElement>('.ext-help-q'); if (i && typeof v === 'string') i.value = v; };
