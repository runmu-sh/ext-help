// src/index.ts
import { defineExtension } from "@muclient/sdk";

// src/store.ts
var CACHE_MAX = 60;
var HISTORY_MAX = 100;
var HelpStore = class {
  constructor(loader) {
    this.loader = loader;
  }
  loader;
  /** What the body shows. */
  shown = null;
  /** The opened query the page belongs to (null while search results are shown). */
  query = null;
  /** The section to scroll to and flash after the next render. */
  focus = null;
  history = [];
  at = -1;
  loading = false;
  error = null;
  /** Panels mounted for this session. */
  mounted = 0;
  cache = /* @__PURE__ */ new Map();
  ticket = 0;
  listeners = /* @__PURE__ */ new Set();
  watch(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  changed() {
    for (const f of [...this.listeners]) f();
  }
  get canBack() {
    return this.at > 0;
  }
  get canForward() {
    return this.at >= 0 && this.at < this.history.length - 1;
  }
  cached(query) {
    return this.cache.get(key(query));
  }
  remember(query, s) {
    const k = key(query);
    this.cache.delete(k);
    this.cache.set(k, s);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
  }
  get cacheSize() {
    return this.cache.size;
  }
  /** Every cached page (the palette reads topic lists from the index here). */
  pages() {
    return [...this.cache.values()];
  }
  /** Open a query: it becomes the newest history entry (anything forward of the current one is dropped). */
  open(query) {
    const q = norm(query);
    if (this.history[this.at] !== q) {
      this.history = this.history.slice(0, this.at + 1);
      this.history.push(q);
      if (this.history.length > HISTORY_MAX) this.history.shift();
      this.at = this.history.length - 1;
    }
    return this.load(q, false);
  }
  back() {
    if (!this.canBack) return Promise.resolve();
    this.at--;
    return this.load(this.history[this.at], true);
  }
  forward() {
    if (!this.canForward) return Promise.resolve();
    this.at++;
    return this.load(this.history[this.at], true);
  }
  /** Show a page that arrived without being asked for (the game pushed it). It joins the history and the cache. */
  push(s) {
    const q = norm(queryOf(s.page));
    if (s.page.kind !== "search") {
      if (this.history[this.at] !== q) {
        this.history = this.history.slice(0, this.at + 1);
        this.history.push(q);
        this.at = this.history.length - 1;
      }
      this.remember(q, s);
      this.query = q;
    } else this.query = null;
    this.ticket++;
    this.shown = s;
    this.loading = false;
    this.error = null;
    this.focus = sectionOf(s.page);
    this.changed();
  }
  /** Search results replace the page; they are not a history entry. */
  async search(query) {
    const l = this.loader();
    const q = norm(query);
    if (!l?.search || !q) return;
    const t = ++this.ticket;
    this.loading = true;
    this.changed();
    try {
      const s = await l.search(q);
      if (t !== this.ticket) return;
      this.shown = s;
      this.query = null;
      this.error = null;
      this.focus = null;
    } catch (e) {
      if (t !== this.ticket) return;
      this.error = reason(e);
    }
    this.loading = false;
    this.changed();
  }
  /** Back to the current history entry (the search field was cleared). */
  restore() {
    const q = this.history[this.at];
    if (q !== void 0) void this.load(q, true);
  }
  async load(q, preferCache) {
    const t = ++this.ticket;
    const hit = this.cache.get(key(q));
    if (preferCache && hit) {
      this.settle(t, q, hit);
      return;
    }
    const l = this.loader();
    if (!l) {
      this.fail(t, q, "not connected");
      return;
    }
    this.loading = true;
    this.error = null;
    this.changed();
    try {
      const s = await l.get(q);
      this.remember(q, s);
      this.settle(t, q, s);
    } catch (e) {
      this.fail(t, q, reason(e));
    }
  }
  settle(t, q, s) {
    if (t !== this.ticket) return;
    this.shown = s;
    this.query = q;
    this.loading = false;
    this.error = null;
    this.focus = sectionOf(s.page);
    this.changed();
  }
  /** A failed request shows the cached page when there is one, otherwise the error. */
  fail(t, q, why) {
    if (t !== this.ticket) return;
    const hit = this.cache.get(key(q));
    this.loading = false;
    if (hit) {
      this.shown = hit;
      this.query = q;
      this.error = null;
      this.focus = sectionOf(hit.page);
    } else this.error = why;
    this.changed();
  }
};
var norm = (q) => String(q ?? "").trim().replace(/\s+/g, " ");
var key = (q) => norm(q).toLowerCase();
var reason = (e) => String(e?.message ?? e ?? "").trim();
function queryOf(p) {
  if (typeof p.query === "string") return p.query;
  if (p.kind === "topic" || p.kind === "section") return p.section ? `${p.topic.key}/${p.section}` : p.topic.key;
  if (p.kind === "category") return `category ${p.category}`;
  return "";
}
var sectionOf = (p) => (p.kind === "topic" || p.kind === "section") && p.section ? String(p.section) : null;

// src/source.ts
var TIMEOUT_MS = 8e3;
var PROBE_MS = 2500;
var rid = () => 1 + Math.floor(Math.random() * 2147483646);
var Sources = class {
  constructor(mu, settings) {
    this.mu = mu;
    this.settings = settings;
  }
  mu;
  settings;
  known = /* @__PURE__ */ new Map();
  probing = /* @__PURE__ */ new Map();
  /** Requests this client is waiting for, so their answers are not taken for pushed pages. */
  pending = /* @__PURE__ */ new Set();
  dialect(sid) {
    const forced = this.settings.source(sid);
    if (forced === "client-help" || forced === "evennia" || forced === "text") return forced;
    return this.known.get(sid) ?? this.seen(sid);
  }
  /** The game showed which dialect it speaks (a pushed page). */
  learn(sid, d) {
    if (!this.known.has(sid) || this.known.get(sid) === "text") this.known.set(sid, d);
  }
  forget(sid) {
    this.known.delete(sid);
    this.probing.delete(sid);
  }
  seen(sid) {
    const g = this.mu.gmcp;
    if (g.seen("Client.Help", sid)) return "client-help";
    if (g.seen("Help.View", sid)) return "evennia";
    return null;
  }
  /** The dialect, asking the game when nothing has told us yet. */
  async resolve(sid) {
    const d = this.dialect(sid);
    if (d) return d;
    const running = this.probing.get(sid);
    if (running) return running;
    const p = this.probe(sid).then((x) => {
      this.known.set(sid, x);
      this.probing.delete(sid);
      return x;
    });
    this.probing.set(sid, p);
    return p;
  }
  async probe(sid) {
    if (!this.mu.gmcp.negotiated(sid)) return "text";
    const codebase = String(this.mu.mssp(sid)?.CODEBASE ?? "");
    const order = /evennia/i.test(codebase) ? ["evennia", "client-help"] : ["client-help", "evennia"];
    for (const d of order) {
      try {
        await this.ask(sid, d, "view", "", PROBE_MS);
        return d;
      } catch {
      }
    }
    return "text";
  }
  /** A loader for the session's store. */
  loader(sid) {
    return {
      get: async (q) => this.load(sid, "view", q),
      search: async (q) => this.load(sid, "search", q)
    };
  }
  async canSearch(sid) {
    return await this.resolve(sid) !== "text";
  }
  async load(sid, what, q) {
    const d = await this.resolve(sid);
    if (d === "text") {
      if (what === "search") throw new Error("this game's help has no search");
      return this.text(sid, q);
    }
    return this.ask(sid, d, what, q, TIMEOUT_MS);
  }
  async ask(sid, d, what, query, timeoutMs) {
    const n = rid();
    this.pending.add(n);
    try {
      if (d === "evennia") {
        const res2 = await this.mu.gmcp.request("Help." + (what === "view" ? "View" : "Search"), { seq: n, data: { query } }, {
          sid,
          expect: "Core.Res",
          key: `help.${n}`,
          timeoutMs,
          match: (x) => Array.isArray(x) && x[1] === n
        });
        if (res2[2] === false) throw new Error(typeof res2[0] === "string" ? res2[0] : "the game refused");
        return { page: checkPage(res2[0]), markup: "pipe" };
      }
      const res = await this.mu.gmcp.request("Client.Help." + (what === "view" ? "Get" : "Search"), { query, req: n }, {
        sid,
        expect: what === "view" ? "Client.Help.Page" : "Client.Help.Results",
        key: `help.${n}`,
        timeoutMs,
        match: (x) => !!x && typeof x === "object" && x.req === n
      });
      if (typeof res.error === "string") throw new Error(res.error);
      return { page: checkPage(res), markup: markupOf(res) };
    } finally {
      setTimeout(() => this.pending.delete(n), 2e3);
    }
  }
  /** The text fallback: send the help command unechoed, capture to the next prompt (or a quiet second), gag it. */
  async text(sid, q) {
    const verb = (this.settings.command(sid) || "help").trim();
    const cmd = q ? `${verb} ${q}` : verb;
    let lines;
    try {
      const got = await this.mu.sessions.request(cmd, {
        sid,
        raw: true,
        gag: true,
        timeoutMs: 1500,
        until: (l) => l.kind === "prompt" ? "done" : "more"
      });
      lines = (got ?? []).filter((l) => l.kind !== "prompt" && l.kind !== "echo").map((l) => l.text);
    } catch (e) {
      const partial = e?.partial;
      if (!partial) throw e;
      lines = partial.filter((l) => l.kind !== "prompt" && l.kind !== "echo").map((l) => l.text);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) throw new Error("the game sent nothing");
    return { page: { kind: "text", query: q, lines }, markup: "text" };
  }
  /** Tell the game whether `help` should go to the panel (it records it; text may still print). */
  prefs(sid, panel) {
    const d = this.dialect(sid);
    if (d === "evennia") void this.mu.gmcp.send("Help.Prefs", { seq: rid(), data: { panel } }, sid);
    else if (d === "client-help") void this.mu.gmcp.send("Client.Help.Prefs", { panel }, sid);
  }
};
var KINDS = /* @__PURE__ */ new Set(["index", "category", "topic", "section", "search", "not_found", "text"]);
function checkPage(x) {
  const p = x;
  if (!p || typeof p !== "object" || !KINDS.has(String(p.kind))) throw new Error("not a help page");
  const list = (v) => Array.isArray(v) ? v : [];
  switch (p.kind) {
    case "index":
      return { kind: "index", query: "", categories: list(p.categories).filter((c) => c && typeof c === "object").map((c) => ({ name: String(c.name ?? ""), topics: topics(c.topics) })) };
    case "category":
      return { kind: "category", query: str(p.query), category: String(p.category ?? ""), topics: topics(p.topics) };
    case "topic":
    case "section": {
      const t = p.topic;
      if (!t || typeof t !== "object" || typeof t.key !== "string") throw new Error("a topic page needs topic.key");
      return {
        kind: p.kind,
        query: str(p.query),
        section: typeof p.section === "string" ? p.section : null,
        topic: {
          key: t.key,
          category: str(t.category),
          summary: str(t.summary),
          intro: str(t.intro),
          aliases: list(t.aliases).map(String),
          links: list(t.links).map(String),
          sections: list(t.sections).filter((s) => s && typeof s === "object").map((s) => ({ title: String(s.title ?? ""), body: String(s.body ?? ""), syntax: list(s.syntax).map(String) }))
        }
      };
    }
    case "search":
      return { kind: "search", query: String(p.query ?? ""), hits: hits(p.hits) };
    case "not_found":
      return { kind: "not_found", query: String(p.query ?? ""), hits: hits(p.hits), suggestions: list(p.suggestions).filter((s) => s && typeof s === "object").map((s) => ({ label: String(s.label ?? s.query ?? ""), query: String(s.query ?? "") })) };
    default:
      return { kind: "text", query: String(p.query ?? ""), lines: list(p.lines).map(String) };
  }
}
var str = (v) => typeof v === "string" ? v : void 0;
var topics = (v) => (Array.isArray(v) ? v : []).filter((t) => t && typeof t === "object" && t.key != null).map((t) => ({ key: String(t.key), category: str(t.category), summary: str(t.summary) }));
var hits = (v) => (Array.isArray(v) ? v : []).filter((h) => h && typeof h === "object" && h.query != null).map((h) => ({ query: String(h.query), key: str(h.key), category: str(h.category), section: str(h.section) ?? null, snippet: str(h.snippet) }));
var markupOf = (p) => p?.markup === "pipe" ? "pipe" : "plain";

// src/markup.ts
var COLOUR = /^\|(?:\[?[rgybmcwxRGYBMCWX]|\[?\d{3}|\[?=[a-z]|\[?#[0-9a-fA-F]{6})/;
var STRIP = /^\|[*^uUhHiIsS>]/;
var REF_HELP = /^help(?:\s+([^<>[\]{}|]+?))?\s*$/i;
function pipeRuns(line) {
  const runs = [];
  let buf = "", hl = false;
  const flush = () => {
    if (!buf) return;
    if (hl) runs.push(asRef(buf) ?? { t: "hl", text: buf });
    else runs.push({ t: "text", text: buf });
    buf = "";
  };
  for (let i = 0; i < line.length; ) {
    if (line[i] !== "|") {
      buf += line[i++];
      continue;
    }
    const rest = line.slice(i);
    if (rest.startsWith("||")) {
      buf += "|";
      i += 2;
      continue;
    }
    if (/^\|n/.test(rest)) {
      flush();
      hl = false;
      i += 2;
      continue;
    }
    if (/^\|\//.test(rest)) {
      buf += " ";
      i += 2;
      continue;
    }
    if (/^\|-/.test(rest)) {
      buf += "    ";
      i += 2;
      continue;
    }
    if (/^\|_/.test(rest)) {
      buf += " ";
      i += 2;
      continue;
    }
    const c = COLOUR.exec(rest);
    if (c) {
      flush();
      hl = true;
      i += c[0].length;
      continue;
    }
    const s = STRIP.exec(rest);
    if (s) {
      i += s[0].length;
      continue;
    }
    buf += "|";
    i++;
  }
  flush();
  return merge(runs);
}
function asRef(text) {
  const m = REF_HELP.exec(text.trim());
  if (!m) return null;
  return { t: "ref", text: text.trim(), query: (m[1] ?? "").trim() };
}
function plainRuns(line) {
  const runs = [];
  const re = /\u0002([^\u0002\u0003]*)\u0003/g;
  let at = 0, m;
  while (m = re.exec(line)) {
    if (m.index > at) runs.push({ t: "text", text: line.slice(at, m.index) });
    const q = m[1].replace(/^help\s+/i, "").trim();
    runs.push({ t: "ref", text: m[1].trim(), query: q });
    at = m.index + m[0].length;
  }
  if (at < line.length) runs.push({ t: "text", text: line.slice(at) });
  return merge(runs);
}
var TEXT_REF = /\bhelp ([A-Za-z@+][\w@+'-]*(?:\/[\w-]+)?)/g;
function textRuns(line) {
  const runs = [];
  let at = 0;
  for (const m of line.matchAll(TEXT_REF)) {
    const q = m[1].replace(/['-]+$/, "");
    const end = m.index + 5 + q.length;
    if (m.index > at) runs.push({ t: "text", text: line.slice(at, m.index) });
    runs.push({ t: "ref", text: line.slice(m.index, end), query: q });
    at = end;
  }
  if (at < line.length) runs.push({ t: "text", text: line.slice(at) });
  return merge(runs);
}
function merge(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.t === r.t && r.t !== "ref") last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}
var runsOf = (markup) => markup === "pipe" ? pipeRuns : markup === "text" ? textRuns : plainRuns;
var wholeHl = (runs) => runs.filter((r) => r.t !== "text" || r.text.trim()).length === 1 && runs.some((r) => r.t !== "text");
function blocks(body, markup) {
  const parse = runsOf(markup);
  const src = String(body ?? "").replace(/\r\n?/g, "\n");
  if (markup === "text") return src ? [{ kind: "lines", lines: src.split("\n").map(parse) }] : [];
  const out = [];
  for (const para of src.split(/\n[ \t]*\n/)) {
    const lines = para.split("\n").filter((l, i, a) => l.trim() || i > 0 && i < a.length - 1);
    if (!lines.length || !lines.some((l) => l.trim())) continue;
    const parsed = lines.map(parse);
    const keep = lines.some((l) => /^[ \t]/.test(l)) || parsed.some(wholeHl);
    if (keep) out.push({ kind: "lines", lines: parsed });
    else out.push({ kind: "p", runs: merge(parsed.flatMap((r, i) => i ? [{ t: "text", text: " " }, ...r] : r)) });
  }
  return out;
}
var slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";

// src/render.ts
var COPY = {
  prompt: "HELP>",
  placeholder: "Search or type a topic",
  aria: "Search help",
  back: "Back",
  forward: "Forward",
  topics: "Topics",
  loading: "Loading help",
  empty: "Search above, or choose Topics for every topic.",
  unavailable: (why) => why ? `Help is unavailable: ${why}` : "Help is unavailable.",
  lead: ["Start with ", "help newbie", ". How to read a syntax line: ", "help syntax", "."],
  crumbRoot: "Help",
  sections: "Sections",
  seeAlso: "See also",
  aliases: "Also",
  matches: (n, q) => `${n} match${n === 1 ? "" : "es"} for \u201C${q}\u201D. ${n ? "Enter opens the first." : ""}`.trim(),
  notFound: (q) => `No help topic matches \u201C${q}\u201D.`,
  didYouMean: "Did you mean",
  textOnly: "This game's help is plain text."
};
function renderPage(mu, page, markup, focus) {
  const h = mu.ui.h;
  const link = (query, label, title, cls = "xref") => h("a", { class: `ext-help-${cls}`, href: "#", "data-help": query, title }, label);
  const crumbs = (...parts) => h(
    "nav",
    { class: "ext-help-crumbs", "aria-label": "Breadcrumbs" },
    ...parts.flatMap((p, i) => [i ? h("span", { class: "ext-help-sep", "aria-hidden": "true" }, " / ") : null, typeof p === "string" ? h("span", null, p) : link(p[1], p[0], void 0, "crumb")])
  );
  const runs = (rs) => rs.map((r) => r.t === "ref" ? link(r.query, r.text, r.query ? `help ${r.query}` : "help") : r.t === "hl" ? h("span", { class: "ext-help-hl" }, r.text) : r.text);
  const body = (bs) => bs.map((b) => b.kind === "p" ? h("p", { class: "ext-help-p" }, runs(b.runs)) : h("div", { class: "ext-help-lines" }, b.lines.map((l) => h("div", { class: "ext-help-line" }, l.length ? runs(l) : "\xA0"))));
  const rows = (items) => h(
    "ul",
    { class: "ext-help-rows" },
    items.map((it) => h("li", { class: "ext-help-row" }, link(it.query, it.label, void 0, "key"), it.note ? h("span", { class: "ext-help-note" }, it.note) : null))
  );
  const topicRows = (ts) => rows(ts.map((t) => ({ query: t.key, label: t.key, note: t.summary })));
  const hitRows = (hs) => rows(hs.map((x) => ({ query: x.query, label: x.query, note: x.snippet })));
  const root = h("article", { class: "ext-help-page", "data-kind": page.kind });
  switch (page.kind) {
    case "index": {
      const L = COPY.lead;
      root.append(h("p", { class: "ext-help-lead" }, L[0], link("newbie", L[1]), L[2], link("syntax", L[3]), L[4]));
      for (const c of page.categories) {
        root.append(h(
          "section",
          { class: "ext-help-cat" },
          h("h2", { class: "ext-help-catname" }, link(`category ${c.name}`, c.name, `All ${c.name} topics`, "catlink")),
          h("div", { class: "ext-help-grid" }, c.topics.map((t) => h("button", { type: "button", class: "ext-help-topic", "data-help": t.key, title: t.summary ?? "" }, t.key)))
        ));
      }
      break;
    }
    case "category":
      root.append(crumbs([COPY.crumbRoot, ""], page.category), h("h1", { class: "ext-help-title" }, page.category), topicRows(page.topics));
      break;
    case "topic":
    case "section": {
      const t = page.topic;
      const secs = t.sections ?? [];
      const want = (page.section ?? focus ?? "").toLowerCase();
      root.append(
        crumbs([COPY.crumbRoot, ""], ...t.category ? [[t.category, `category ${t.category}`]] : [], t.key),
        h("h1", { class: "ext-help-title" }, t.key)
      );
      if (t.summary) root.append(h("p", { class: "ext-help-summary" }, t.summary));
      if (secs.length >= 4) {
        root.append(h(
          "nav",
          { class: "ext-help-toc", "aria-label": COPY.sections },
          h("span", { class: "ext-help-label" }, COPY.sections),
          secs.map((s) => h("a", { class: "ext-help-tocitem", href: `#help-sec-${slug(s.title)}`, "data-sec": s.title }, s.title))
        ));
      }
      if (t.intro) root.append(...body(blocks(t.intro, markup)));
      for (const s of secs) {
        const on = !!want && s.title.toLowerCase() === want;
        root.append(h(
          "section",
          { class: "ext-help-sec", id: `help-sec-${slug(s.title)}`, "data-sec": s.title },
          s.title ? h("h3", { class: `ext-help-h3${on ? " ext-help-focus" : ""}` }, on ? h("span", { class: "ext-help-mark", "aria-hidden": "true" }, "\u25B8 ") : null, s.title) : null,
          ...body(blocks(s.body, markup))
        ));
      }
      if (t.links?.length) root.append(h("p", { class: "ext-help-also" }, h("span", { class: "ext-help-label" }, COPY.seeAlso), t.links.map((k) => link(k, k, void 0, "chip"))));
      break;
    }
    case "search":
      root.append(h("p", { class: "ext-help-count", role: "status" }, COPY.matches(page.hits.length, page.query)), hitRows(page.hits));
      break;
    case "not_found":
      root.append(h("p", { class: "ext-help-count", role: "status" }, COPY.notFound(page.query)));
      if (page.suggestions?.length) root.append(h("p", { class: "ext-help-also" }, h("span", { class: "ext-help-label" }, COPY.didYouMean), page.suggestions.map((s) => link(s.query, s.label, void 0, "chip"))));
      if (page.hits?.length) root.append(hitRows(page.hits));
      break;
    case "text":
      if (page.query) root.append(crumbs([COPY.crumbRoot, ""], page.query));
      root.append(...body(blocks(page.lines.join("\n"), "text")));
      break;
  }
  return root;
}
function firstHit(page) {
  if (!page) return null;
  if (page.kind === "search") return page.hits[0]?.query ?? null;
  if (page.kind === "not_found") return page.suggestions?.[0]?.query ?? page.hits?.[0]?.query ?? null;
  return null;
}

// src/panel.ts
var DEBOUNCE_MS = 180;
var FLASH_MS = 1400;
function mountPanel(mu, deps, el, sid) {
  const h = mu.ui.h, c = mu.ui.css;
  const store = sid ? deps.store(sid) : null;
  const input = h("input", { class: "ext-help-q", type: "search", placeholder: COPY.placeholder, "aria-label": COPY.aria, autocomplete: "off", spellcheck: "false", "data-testid": "help-input" });
  const cmd = (label, testid, run) => h("button", { type: "button", class: c.cmd, "data-testid": testid, onclick: run }, label);
  const back = cmd(COPY.back, "help-back", () => {
    input.value = "";
    void store?.back();
  });
  const fwd = cmd(COPY.forward, "help-forward", () => {
    input.value = "";
    void store?.forward();
  });
  const topics2 = cmd(COPY.topics, "help-topics", () => {
    input.value = "";
    void store?.open("");
  });
  const siteBtn = cmd("", "help-site", () => {
    const u = sid && deps.site(sid);
    if (u) mu.panels.openWeb({ url: u, id: "help-site", title: "Help" }, sid);
  });
  const err = h("div", { class: "ext-help-err", role: "alert", hidden: true, "data-testid": "help-error" });
  const hint = h("div", { class: "ext-help-hint", hidden: true }, COPY.textOnly);
  const body = h("div", { class: "ext-help-body", tabindex: "-1", "aria-live": "polite", "data-testid": "help-body" });
  el.replaceChildren(h(
    "div",
    { class: "ext-help", "data-testid": "help-panel" },
    h(
      "div",
      { class: "ext-help-head" },
      h("span", { class: "ext-help-prompt", "aria-hidden": "true" }, COPY.prompt),
      input,
      h("div", { class: "ext-help-cmds" }, back, fwd, topics2, siteBtn)
    ),
    err,
    hint,
    body
  ));
  const offRegion = mu.a11y.region(el, { name: "Help", key: "help" });
  let searchable = true;
  if (sid) void deps.canSearch(sid).then((v) => {
    searchable = v;
    hint.hidden = v;
  }).catch(() => {
  });
  let timer, flashTimer;
  let drawn = null;
  const calm = () => !!mu.prefs.get("effects.calm");
  const reveal = (title) => {
    const sec = body.querySelector(`#help-sec-${CSS.escape(slug(title))}`);
    if (!sec) return;
    sec.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    if (calm()) return;
    const head = sec.querySelector(".ext-help-h3") ?? sec;
    head.classList.remove("ext-help-flash");
    void head.offsetWidth;
    head.classList.add("ext-help-flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => head.classList.remove("ext-help-flash"), FLASH_MS);
  };
  const draw = () => {
    back.disabled = !store?.canBack;
    fwd.disabled = !store?.canForward;
    const site = sid ? deps.site(sid) : null;
    siteBtn.hidden = !site;
    if (site) {
      try {
        siteBtn.textContent = `${new URL(site).host} help`;
      } catch {
        siteBtn.hidden = true;
      }
    }
    err.hidden = !store?.error;
    err.textContent = store?.error ? COPY.unavailable(store.error) : "";
    const shown = store?.shown;
    body.setAttribute("aria-busy", store?.loading ? "true" : "false");
    if (!shown) {
      const k = `empty:${!!store?.loading}`;
      if (drawn !== k) {
        body.replaceChildren(h("p", { class: "ext-help-empty", "data-testid": "help-empty" }, store?.loading ? COPY.loading : COPY.empty));
        drawn = k;
      }
      return;
    }
    if (drawn === shown) return;
    drawn = shown;
    body.replaceChildren(renderPage(mu, shown.page, shown.markup, store.focus));
    const f = store.focus;
    if (f) {
      store.focus = null;
      requestAnimationFrame(() => reveal(f));
    } else body.scrollTop = 0;
  };
  const go = (q) => {
    clearTimeout(timer);
    input.value = "";
    void store?.open(q);
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      store?.restore();
      return;
    }
    if (!searchable) return;
    timer = setTimeout(() => {
      void store?.search(q);
    }, DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = input.value.trim();
      const shown = store?.shown?.page;
      const first = shown && shown.kind === "search" && shown.query.toLowerCase() === q.toLowerCase() ? firstHit(shown) : null;
      go(first ?? q);
    } else if (e.key === "Escape" && input.value) {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(timer);
      input.value = "";
      store?.restore();
    }
  });
  body.addEventListener("click", (e) => {
    const t = e.target;
    const toc = t.closest(".ext-help-tocitem");
    if (toc) {
      e.preventDefault();
      reveal(toc.dataset.sec ?? "");
      return;
    }
    const a = t.closest("[data-help]");
    if (a) {
      e.preventDefault();
      go(a.dataset.help ?? "");
    }
  });
  const off = store?.watch(draw);
  if (store) {
    store.mounted++;
    if (!store.shown && !store.loading && store.at < 0) void store.open("");
  }
  draw();
  return () => {
    clearTimeout(timer);
    clearTimeout(flashTimer);
    off?.();
    offRegion();
    if (store) store.mounted--;
  };
}
var snapshot = (el) => el.querySelector(".ext-help-q")?.value || void 0;
var restore = (el, v) => {
  const i = el.querySelector(".ext-help-q");
  if (i && typeof v === "string") i.value = v;
};

// src/css.ts
var CSS2 = `
.ext-help [hidden] { display: none !important; }
.ext-help { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-elev); color: var(--fg); font-family: var(--font-mono, monospace); }
.ext-help-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 10px; border-bottom: 1px solid var(--border-bright); }
.ext-help-prompt { color: var(--accent-bright); font-size: .78rem; letter-spacing: .08em; }
.ext-help-q { flex: 1 1 16ch; min-width: 12ch; background: transparent; border: 0; border-bottom: 1px solid var(--border); color: var(--fg); font: inherit; font-size: .8rem; padding: 3px 2px; outline: none; }
.ext-help-q:focus { border-bottom-color: var(--accent-bright); }
.ext-help-q::placeholder { color: var(--fg-faint); }
.ext-help-cmds { display: flex; gap: 2px; }
.ext-help-err { padding: 4px 10px; color: var(--alert); font-size: .74rem; }
.ext-help-hint { padding: 4px 10px 0; color: var(--fg-faint); font-size: .66rem; letter-spacing: .12em; text-transform: uppercase; }
.ext-help-body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px 18px; font-size: .86rem; line-height: 1.5; }
.ext-help-body:focus { outline: none; }
.ext-help-empty { color: var(--fg-dim); font-size: .8rem; padding: 18px 2px; }
.ext-help-page { max-width: 88ch; }
.ext-help-lead { margin: 0 0 12px; color: var(--fg-dim); }
.ext-help-crumbs { font-size: .64rem; letter-spacing: .16em; text-transform: uppercase; color: var(--fg-faint); margin-bottom: 6px; }
.ext-help-crumbs a { color: var(--fg-faint); text-decoration: none; }
.ext-help-crumbs a:is(:hover, :focus-visible) { color: var(--accent-bright); }
.ext-help-title { margin: 0 0 4px; color: var(--gold); font-size: .95rem; font-weight: normal; letter-spacing: .16em; text-transform: uppercase; }
.ext-help-summary { margin: 0 0 10px; color: var(--fg-dim); }
.ext-help-cat { margin: 14px 0 6px; }
.ext-help-catname { display: flex; align-items: center; gap: 1ch; margin: 0 0 6px; font-size: .66rem; font-weight: normal; letter-spacing: .24em; text-transform: uppercase; }
.ext-help-catname::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--border-bright), transparent); }
.ext-help-catname a { color: var(--gold); text-decoration: none; }
.ext-help-catname a:is(:hover, :focus-visible) { background: var(--accent); color: var(--bg-deep); }
.ext-help-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(21ch, 1fr)); gap: 0 1ch; }
.ext-help-topic { all: unset; cursor: pointer; padding: 1px 2px; color: var(--accent-bright); font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ext-help-topic:is(:hover, :focus-visible) { background: var(--accent); color: var(--bg-deep); }
.ext-help-xref, .ext-help-key, .ext-help-chip { color: var(--accent-bright); text-decoration: underline dotted; text-underline-offset: 2px; cursor: pointer; }
.ext-help-xref:is(:hover, :focus-visible), .ext-help-key:is(:hover, :focus-visible), .ext-help-chip:is(:hover, :focus-visible) { background: var(--accent); color: var(--bg-deep); text-decoration: none; outline: none; }
.ext-help-hl { color: var(--accent-bright); }
.ext-help-p { margin: 0 0 8px; }
.ext-help-lines { margin: 0 0 8px; white-space: pre-wrap; }
.ext-help-toc { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 1.4ch; margin: 6px 0 12px; padding: 6px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.ext-help-tocitem { color: var(--accent-bright); font-size: .74rem; text-decoration: none; }
.ext-help-tocitem:is(:hover, :focus-visible) { background: var(--accent); color: var(--bg-deep); outline: none; }
.ext-help-label { color: var(--fg-faint); font-size: .62rem; letter-spacing: .2em; text-transform: uppercase; margin-right: 1ch; }
.ext-help-sec { margin: 14px 0 0; scroll-margin-top: 8px; }
.ext-help-h3 { display: flex; align-items: center; gap: 1ch; margin: 0 0 6px; color: var(--accent-bright); font-size: .7rem; font-weight: normal; letter-spacing: .2em; text-transform: uppercase; }
.ext-help-h3::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--border-bright), transparent); }
.ext-help-mark { color: var(--gold); }
.ext-help-flash { animation: ext-help-flash 1.4s ease-out; }
@keyframes ext-help-flash { from { background: var(--tint-sel, var(--accent)); } to { background: transparent; } }
:root[data-calm] .ext-help-flash { animation: none; }
.ext-help-rows { list-style: none; margin: 6px 0 0; padding: 0; }
.ext-help-row { display: grid; grid-template-columns: minmax(14ch, max-content) 1fr; gap: 2ch; padding: 2px 0; border-bottom: 1px solid var(--hair, var(--border)); }
.ext-help-note { color: var(--fg-dim); }
.ext-help-count { margin: 0 0 8px; color: var(--fg-dim); }
.ext-help-also { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 1.4ch; margin: 14px 0 0; }
`;

// src/index.ts
var PANEL = "help";
function parseHelp(text, verb = "help") {
  const t = text.trim();
  const v = (verb || "help").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const s = new RegExp(`^${v}search(?:\\s+(.+))?$`, "i").exec(t);
  if (s) return { what: "search", query: norm(s[1] ?? "") };
  const m = new RegExp(`^${v}(?:\\s+(.+))?$`, "i").exec(t);
  if (!m) return null;
  const q = norm(m[1] ?? "");
  if (/^[/-]/.test(q)) return null;
  return { what: "view", query: q };
}
var index_default = defineExtension({
  async activate(ctx) {
    const mu = ctx.mu;
    mu.settings.define({
      title: "Help",
      items: [
        {
          key: "inPanel",
          label: "Help in its own panel",
          default: true,
          kind: "toggle",
          hint: "Typed help commands open here instead of printing in the terminal. Always off in screen reader mode."
        },
        {
          key: "source",
          label: "Help source",
          default: "auto",
          kind: "select",
          scope: "world",
          options: [{ value: "auto", label: "automatic" }, { value: "client-help", label: "GMCP Client.Help" }, { value: "evennia", label: "GMCP Help (Evennia)" }, { value: "text", label: "text (the help command)" }],
          hint: "Where pages come from. Automatic uses what the game supports."
        },
        {
          key: "command",
          label: "Help command",
          default: "help",
          kind: "text",
          scope: "world",
          hint: "The verb this game uses for help (help, @help, info \u2026). With \u201Csearch\u201D after it, it searches."
        }
      ],
      sections: [{ page: "text", title: "Help", keys: ["inPanel"] }]
    });
    const setting = (key2, sid) => mu.settings.get(key2, sid ? { sid } : void 0);
    const verbOf = (sid) => String(setting("command", sid) || "help");
    const screenReader = () => mu.prefs.get("a11y.screenReader") === true;
    const inPanel = (sid) => setting("inPanel", sid) !== false && !screenReader();
    const sources = new Sources(mu, { source: (sid) => String(setting("source", sid) || "auto"), command: verbOf });
    const custom = /* @__PURE__ */ new Map();
    const stores = /* @__PURE__ */ new Map();
    const loaderOf = (sid) => {
      const c = custom.get(sid);
      if (c) {
        const markup = c.markup ?? "plain";
        return {
          get: async (q) => ({ page: checkPage(await c.get(q)), markup }),
          ...c.search ? { search: async (q) => ({ page: checkPage(await c.search(q)), markup }) } : {}
        };
      }
      const s = mu.sessions.list().find((x) => x.id === sid);
      if (!s || s.state !== "connected") return null;
      return sources.loader(sid);
    };
    const storeOf = (sid) => {
      let st = stores.get(sid);
      if (!st) {
        st = new HelpStore(() => loaderOf(sid));
        stores.set(sid, st);
      }
      return st;
    };
    const active = () => mu.sessions.active()?.id ?? null;
    const canSearch = async (sid) => {
      const c = custom.get(sid);
      if (c) return !!c.search;
      return sources.canSearch(sid);
    };
    const prefSent = /* @__PURE__ */ new Map();
    const syncPrefs = (sid) => {
      const d = sources.dialect(sid);
      if (!d || d === "text") return;
      const v = inPanel(sid);
      if (prefSent.get(sid) === v) return;
      prefSent.set(sid, v);
      sources.prefs(sid, v);
    };
    const syncAll = () => {
      for (const s of mu.sessions.list()) if (s.state === "connected") syncPrefs(s.id);
    };
    mu.settings.watch("inPanel", syncAll);
    mu.prefs.watch("a11y.screenReader", syncAll);
    mu.sessions.each((s) => {
      storeOf(s.id);
      return () => {
        stores.delete(s.id);
        custom.delete(s.id);
        prefSent.delete(s.id);
        sources.forget(s.id);
      };
    });
    mu.sessions.on("state", (s) => {
      if (s.state === "connected") {
        sources.forget(s.id);
        prefSent.delete(s.id);
        syncPrefs(s.id);
      }
    });
    const openPanel = (sid, focus = true) => mu.panels.open(PANEL, {}, { sid, focus });
    const open = async (query = "", sid) => {
      const s = sid ?? active();
      if (!s) return;
      openPanel(s);
      await storeOf(s).open(query);
    };
    const show = (page, sid, markup, openIt) => {
      storeOf(sid).push({ page, markup });
      if (openIt) openPanel(sid, false);
    };
    const pushed = (sid, data, markup, d, openIt) => {
      sources.learn(sid, d);
      syncPrefs(sid);
      let page;
      try {
        page = checkPage(data);
      } catch {
        return;
      }
      show(page, sid, markup, openIt);
    };
    const ours = (data) => {
      const req = data?.req;
      return typeof req === "number" && sources.pending.has(req);
    };
    mu.gmcp.on("Client.Help.Page", (data, m) => {
      if (!m.replay && !ours(data)) pushed(m.sid, data, markupOf(data), "client-help", inPanel(m.sid));
    });
    mu.gmcp.on("Client.Help.Results", (data, m) => {
      if (!m.replay && !ours(data)) pushed(m.sid, data, markupOf(data), "client-help", inPanel(m.sid));
    });
    mu.gmcp.on("Help.View", (data, m) => {
      if (!m.replay) pushed(m.sid, data, "pipe", "evennia", false);
    });
    mu.input.stage({
      id: "help.route",
      phase: "guard",
      order: 50,
      run(cmd, c) {
        if (!inPanel(c.sid)) return;
        const hit = parseHelp(cmd.text, verbOf(c.sid));
        if (!hit || hit.what === "search" && !hit.query) return;
        cmd.swallow();
        openPanel(c.sid);
        const st = storeOf(c.sid);
        if (hit.what === "search") void st.search(hit.query);
        else void st.open(hit.query);
      }
    });
    mu.commands.register({ id: "help.open", title: "Open help", keys: ["F1"], group: "Help", when: "session", run: (arg) => open(typeof arg === "string" ? arg : "") });
    mu.commands.register({
      id: "help.lookup",
      title: "Look up a topic",
      group: "Help",
      when: "session",
      run: async (arg) => {
        const q = typeof arg === "string" ? arg : await mu.ui.prompt({ title: "Help topic", placeholder: "topic or words" });
        if (q != null) await open(q);
      }
    });
    mu.menus.add({ id: "help.menu", slot: "main", section: "app", order: 15, title: "Help", command: "help.open", when: "session" });
    mu.menus.context({
      id: "help.word",
      target: "word",
      title: (t) => `Look up \u201C${t.kind === "word" ? t.word : ""}\u201D in Help`,
      when: (t) => t.kind === "word" && /\w/.test(t.word),
      run: (t) => {
        if (t.kind === "word") void open(t.word.replace(/^\W+|\W+$/g, ""), t.sid);
      }
    });
    mu.menus.context({
      id: "help.selection",
      target: "selection",
      title: "Look up in Help",
      when: (t) => t.kind === "selection" && t.text.trim().length > 0 && t.text.length <= 60,
      run: (t) => {
        if (t.kind === "selection") void open(norm(t.text), t.sid);
      }
    });
    mu.palette.provide({
      mode: "help",
      prefix: "?",
      title: "Help topics",
      async items(query, { sid }) {
        const s = sid ?? active();
        if (!s) return [];
        const st = storeOf(s);
        let idx = st.cached("");
        if (!idx) {
          const l = loaderOf(s);
          if (l) {
            try {
              idx = await l.get("");
              st.remember("", idx);
            } catch {
            }
          }
        }
        const q = norm(query).toLowerCase();
        const list = idx?.page.kind === "index" ? idx.page.categories.flatMap((c) => c.topics.map((t) => ({ ...t, category: t.category ?? c.name }))) : [];
        const items = list.filter((t) => !q || t.key.toLowerCase().includes(q) || (t.summary ?? "").toLowerCase().includes(q)).sort((a, b) => Number(!a.key.toLowerCase().startsWith(q)) - Number(!b.key.toLowerCase().startsWith(q))).slice(0, 50).map((t) => ({ id: `help:${t.key}`, label: t.key, hint: t.summary ?? t.category, keywords: [t.category ?? ""], run: () => {
          void open(t.key, s);
        } }));
        if (q) items.push({ id: `help:?${q}`, label: `help ${norm(query)}`, hint: "Open in Help", keywords: [], run: () => {
          void open(norm(query), s);
        } });
        return items;
      }
    });
    mu.ui.style(CSS2);
    mu.panels.register({
      id: PANEL,
      title: "Help",
      perSession: true,
      order: 60,
      defaultPosition: "right-top",
      mount: (el, p) => mountPanel(mu, { store: (sid) => storeOf(sid), canSearch, site: (sid) => mu.sessions.meta(sid)?.links?.help ?? null }, el, p.sid),
      snapshot: (el) => snapshot(el),
      restore: (el, v) => restore(el, v)
    });
    const api = (track) => ({
      open: (q, sid) => open(q ?? "", sid),
      show: (page, sid, o) => {
        const s = sid ?? active();
        if (s) show(checkPage(page), s, o?.markup ?? "plain", o?.open !== false);
      },
      page: (sid) => {
        const s = sid ?? active();
        return s && stores.get(s)?.shown?.page || null;
      },
      provideSource: (sid, src) => {
        custom.set(sid, src);
        return track(() => {
          if (custom.get(sid) === src) custom.delete(sid);
        });
      },
      dialect: (sid) => {
        const s = sid ?? active();
        if (!s) return null;
        return custom.has(s) ? "custom" : sources.dialect(s);
      }
    });
    ctx.exports((caller) => api(caller.track));
  }
});
export {
  index_default as default,
  parseHelp
};
