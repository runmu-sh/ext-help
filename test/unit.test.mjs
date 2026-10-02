// Unit tests: markup, the store and request parsing, without a host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const M = await load('src/markup.ts');
const S = await load('src/store.ts');
const SRC = await load('src/source.ts');

test('pipe markup: help references become links, other highlights stay highlights, || is a pipe', () => {
  assert.deepEqual(M.pipeRuns('For card games, see |whelp cards|n.'), [
    { t: 'text', text: 'For card games, see ' }, { t: 'ref', text: 'help cards', query: 'cards' }, { t: 'text', text: '.' },
  ]);
  assert.deepEqual(M.pipeRuns('Roll in |wNdS|n || not |rred'), [
    { t: 'text', text: 'Roll in ' }, { t: 'hl', text: 'NdS' }, { t: 'text', text: ' | not ' }, { t: 'hl', text: 'red' },
  ]);
  assert.deepEqual(M.pipeRuns('|whelp|n alone'), [{ t: 'ref', text: 'help', query: '' }, { t: 'text', text: ' alone' }]);
  // A placeholder is not a reference.
  assert.equal(M.pipeRuns('|whelp <topic>|n')[0].t, 'hl');
});

test('paragraphs reflow, except syntax lines and indented ones', () => {
  const b = M.blocks('|wdice hold <positions>|n\n\nHold specific dice in place so\nrerolls leave them.\nAlias: |wdice keep|n.', 'pipe');
  assert.equal(b.length, 2);
  assert.equal(b[0].kind, 'lines');
  assert.equal(b[1].kind, 'p');
  assert.equal(b[1].runs.map((r) => r.text).join(''), 'Hold specific dice in place so rerolls leave them. Alias: dice keep.');
  const ind = M.blocks('Usage:\n  look\n  look <thing>', 'plain');
  assert.equal(ind[0].kind, 'lines');
  assert.equal(ind[0].lines.length, 3);
});

test('plain markup marks references with \\u0002…\\u0003; text markup links "help <word>"', () => {
  assert.deepEqual(M.plainRuns('See \u0002help combat\u0003 and \u0002trust\u0003.').filter((r) => r.t === 'ref').map((r) => r.query), ['combat', 'trust']);
  assert.deepEqual(M.textRuns('See also: help combat, help grapple/press.').filter((r) => r.t === 'ref').map((r) => r.query), ['combat', 'grapple/press']);
  assert.equal(M.textRuns('type help <topic>').some((r) => r.t === 'ref'), false);
  assert.equal(M.slug('Two Kinds of Command'), 'two-kinds-of-command');
});

const page = (key) => ({ page: { kind: 'topic', query: key, topic: { key, sections: [] } }, markup: 'plain' });
function fakeLoader() {
  const calls = [];
  let fail = false;
  return {
    calls, setFail: (v) => { fail = v; },
    loader: { get: async (q) => { calls.push(q); if (fail) throw new Error('timeout'); return page(q); }, search: async (q) => ({ page: { kind: 'search', query: q, hits: [{ query: 'a' }] }, markup: 'plain' }) },
  };
}

test('history: back, forward, and a new open drops what was forward', async () => {
  const f = fakeLoader();
  const st = new S.HelpStore(() => f.loader);
  await st.open(''); await st.open('combat'); await st.open('dice');
  assert.deepEqual(st.history, ['', 'combat', 'dice']);
  await st.back(); await st.back();
  assert.equal(st.query, '');
  assert.equal(st.canBack, false);
  assert.equal(st.canForward, true);
  await st.forward();
  assert.equal(st.query, 'combat');
  await st.open('trust');
  assert.deepEqual(st.history, ['', 'combat', 'trust']);
  assert.equal(st.canForward, false);
  // Back and forward read the cache.
  assert.deepEqual(f.calls, ['', 'combat', 'dice', 'trust']);
});

test('the cache keeps the last 60 pages', async () => {
  const f = fakeLoader();
  const st = new S.HelpStore(() => f.loader);
  for (let i = 0; i < 61; i++) await st.open(`t${i}`);
  assert.equal(st.cacheSize, S.CACHE_MAX);
  assert.equal(st.cached('t0'), undefined);
  assert.ok(st.cached('t60'));
  assert.ok(st.cached('T1'), 'keys ignore case');
});

test('a failed request falls back to the cached page, else shows the error', async () => {
  const f = fakeLoader();
  const st = new S.HelpStore(() => f.loader);
  await st.open('combat');
  f.setFail(true);
  await st.open('combat');
  assert.equal(st.error, null);
  assert.equal(st.shown.page.topic.key, 'combat');
  await st.open('nothing');
  assert.equal(st.error, 'timeout');
  const off = new S.HelpStore(() => null);
  await off.open('x');
  assert.equal(off.error, 'not connected');
});

test('search results replace the page without a history entry; restore goes back', async () => {
  const f = fakeLoader();
  const st = new S.HelpStore(() => f.loader);
  await st.open('combat');
  await st.search('gra');
  assert.equal(st.shown.page.kind, 'search');
  assert.deepEqual(st.history, ['combat']);
  st.restore();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(st.shown.page.kind, 'topic');
});

test('a slow answer does not overwrite a newer one', async () => {
  let release;
  const st = new S.HelpStore(() => ({ get: (q) => (q === 'slow' ? new Promise((r) => { release = () => r(page('slow')); }) : Promise.resolve(page(q))) }));
  const a = st.open('slow');
  await st.open('fast');
  release(); await a;
  assert.equal(st.shown.page.topic.key, 'fast');
});

test('checkPage keeps the shapes the panel needs and refuses junk', () => {
  assert.throws(() => SRC.checkPage({ kind: 'nope' }));
  assert.throws(() => SRC.checkPage({ kind: 'topic', topic: {} }));
  const p = SRC.checkPage({ kind: 'section', query: 'grapple/press', section: 'press', topic: { key: 'grapple', sections: [{ title: 'press', body: 'x', syntax: ['press'] }], links: ['combat'] } });
  assert.equal(p.section, 'press');
  assert.equal(p.topic.sections[0].syntax[0], 'press');
  assert.deepEqual(SRC.checkPage({ kind: 'not_found', query: 'zz', hits: [] }).suggestions, []);
  const id = SRC.rid();
  assert.ok(Number.isInteger(id) && id > 0 && id < 2 ** 31);
});
