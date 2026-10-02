/**
 * The extension in the headless μClient host (@runmu.sh/dev/test): GMCP in both dialects, the input guard,
 * pushed pages, settings and clean disposal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from './load.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const find = () => process.env.MUCLIENT_DEV_TEST ?? createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev/test');
const { createHost } = await import(pathToFileURL(find()).href);
const { parseHelp } = await load('src/index.ts');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const INDEX = { kind: 'index', query: '', categories: [{ name: 'General', topics: [{ key: 'newbie', summary: 'Start here.' }, { key: 'dice', summary: 'Roll dice.' }] }] };
const DICE = { kind: 'topic', query: 'dice', topic: { key: 'dice', category: 'Games', summary: 'Roll dice.', sections: [{ title: 'dice roll', body: '|wdice roll <NdS>|n\n\nRoll. See |whelp cards|n.' }], links: ['cards'] } };

/** The game side of the Evennia dialect: answer Help.View / Help.Search sent through gmcp.request. */
function evennia(host, pages) {
  let seen = 0;
  return async () => {
    for (; seen < host.sent.length; seen++) {
      const s = host.sent[seen];
      if (s.kind !== 'gmcp' || !/^Help\.(View|Search)$/.test(s.pkg)) continue;
      const q = s.data.data.query;
      const page = s.pkg === 'Help.Search' ? { kind: 'search', query: q, hits: [{ query: 'dice', snippet: 'Roll dice.' }] } : pages[q] ?? { kind: 'not_found', query: q, hits: [] };
      await tick();
      host.gmcp(s.sid, 'Core.Res', [page, s.data.seq, true]);
    }
  };
}

test('parses help, help category and helpsearch, with a custom verb', () => {
  assert.deepEqual(parseHelp('help'), { what: 'view', query: '' });
  assert.deepEqual(parseHelp('HELP  grapple/press '), { what: 'view', query: 'grapple/press' });
  assert.deepEqual(parseHelp('help category combat'), { what: 'view', query: 'category combat' });
  assert.deepEqual(parseHelp('helpsearch grab'), { what: 'search', query: 'grab' });
  assert.deepEqual(parseHelp('@help dice', '@help'), { what: 'view', query: 'dice' });
  assert.equal(parseHelp('helper'), null);
  assert.equal(parseHelp('help/add x'), null);
  assert.equal(parseHelp('say help'), null);
});

test('registers its panel, commands, settings and the Text page section', async () => {
  const host = createHost({ root: ROOT });
  await host.load('src/index.ts');
  assert.ok(host.panels.has('help'));
  assert.equal(host.panels.get('help').perSession, true);
  assert.deepEqual(host.commands.get('help.open').keys, ['F1']);
  assert.ok(host.commands.has('help.lookup'));
  assert.equal(host.setting('inPanel'), true);
  assert.deepEqual(host.settingsSchema.sections, [{ page: 'text', title: 'Help', keys: ['inPanel'] }]);
  const label = host.settingsSchema.items.find((i) => i.key === 'inPanel').label;
  assert.equal(label, 'Help in its own panel');
  const paths = host.calls.map((c) => c.path);
  for (const p of ['menus.add', 'menus.context', 'palette.provide', 'input.stage']) assert.ok(paths.includes(p), p);
  assert.ok(host.live().includes('ui.style'), 'injects its stylesheet');
  assert.equal(host.errors.length, 0);
  await host.unload();
  assert.deepEqual(host.live(), [], 'everything registered through mu is disposed');
});

test('evennia dialect: open asks Help.View {seq, data} and matches Core.Res by seq', async () => {
  const host = createHost({ root: ROOT, settings: { source: 'evennia' } });
  const ext = await host.load('src/index.ts');
  const game = evennia(host, { '': INDEX, dice: DICE });
  const p = ext.api.open('dice');
  await tick(); await game(); await p;
  const req = host.sends('gmcp').find((s) => s.pkg === 'Help.View');
  assert.equal(req.data.data.query, 'dice');
  assert.ok(Number.isInteger(req.data.seq) && req.data.seq > 0);
  assert.equal(ext.api.page().topic.key, 'dice');
  assert.equal(ext.api.dialect(), 'evennia');
  assert.ok(host.calls.some((c) => c.path === 'panels.open' && c.args[0] === 'help'), 'opens the panel');
  await host.unload();
});

test('typed "help x" is swallowed and opened in the panel; off, it goes to the game', async () => {
  const host = createHost({ root: ROOT, settings: { source: 'evennia' } });
  const ext = await host.load('src/index.ts');
  const stage = host.calls.find((c) => c.path === 'input.stage').args[0];
  const game = evennia(host, { dice: DICE });
  const edit = (text) => { const e = { text, source: 'cmd', swallowed: false, swallow() { e.swallowed = true; } }; return e; };
  const e1 = edit('help dice');
  stage.run(e1, { sid: 's1', worldId: 'w1', phase: 'guard' });
  assert.equal(e1.swallowed, true);
  await tick(); await game(); await tick();
  assert.equal(ext.api.page('s1').topic.key, 'dice');
  const e2 = edit('helpsearch roll');
  stage.run(e2, { sid: 's1', worldId: 'w1', phase: 'guard' });
  assert.equal(e2.swallowed, true);
  await tick(); await game(); await tick();
  assert.equal(ext.api.page('s1').kind, 'search');
  const e3 = edit('look');
  stage.run(e3, { sid: 's1', worldId: 'w1', phase: 'guard' });
  assert.equal(e3.swallowed, false);
  host.mu.settings.set('inPanel', false);
  const e4 = edit('help dice');
  stage.run(e4, { sid: 's1', worldId: 'w1', phase: 'guard' });
  assert.equal(e4.swallowed, false, 'with the setting off help prints in the terminal');
  await host.unload();
});

test('Help.Prefs is sent when the dialect is known and when the setting changes', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  host.gmcp('Help.View', DICE); // the game pushed a page: it speaks the Evennia dialect
  assert.equal(ext.api.dialect(), 'evennia');
  const prefs = () => host.sends('gmcp').filter((s) => s.pkg === 'Help.Prefs').map((s) => s.data.data.panel);
  assert.deepEqual(prefs(), [true]);
  host.mu.settings.set('inPanel', false);
  assert.deepEqual(prefs(), [true, false]);
  // A pushed Evennia page updates the panel but does not open it (the game printed it already).
  assert.equal(ext.api.page().topic.key, 'dice');
  assert.equal(host.calls.filter((c) => c.path === 'panels.open').length, 0);
  await host.unload();
});

test('client-help dialect: Get with req, answered by Client.Help.Page with that req; a push opens the panel', async () => {
  const host = createHost({ root: ROOT, settings: { source: 'client-help' } });
  const ext = await host.load('src/index.ts');
  const p = ext.api.open('');
  await tick();
  const get = host.sends('gmcp').find((s) => s.pkg === 'Client.Help.Get');
  assert.deepEqual(Object.keys(get.data).sort(), ['query', 'req']);
  host.gmcp('Client.Help.Page', { ...INDEX, req: get.data.req });
  await p;
  assert.equal(ext.api.page().kind, 'index');
  const opens = host.calls.filter((c) => c.path === 'panels.open').length;
  host.gmcp('Client.Help.Page', { kind: 'topic', topic: { key: 'combat', sections: [] } });
  assert.equal(ext.api.page().topic.key, 'combat');
  assert.equal(host.calls.filter((c) => c.path === 'panels.open').length, opens + 1, 'an unsolicited page opens the panel');
  assert.equal(host.errors.length, 0);
  await host.unload();
});

test('a malformed pushed page is ignored', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  host.gmcp('Help.View', { kind: 'topic', topic: 'nope' });
  assert.equal(ext.api.page(), null);
  assert.equal(host.errors.length, 0);
  await host.unload();
});

test('provideSource replaces the game as the source for a session', async () => {
  const host = createHost({ root: ROOT });
  const ext = await host.load('src/index.ts');
  const off = ext.api.provideSource('s1', { get: async (q) => ({ kind: 'topic', query: q, topic: { key: q || 'index', sections: [] } }) });
  await ext.api.open('wiki');
  assert.equal(ext.api.page('s1').topic.key, 'wiki');
  assert.equal(ext.api.dialect('s1'), 'custom');
  off();
  assert.notEqual(ext.api.dialect('s1'), 'custom');
  await host.unload();
});
