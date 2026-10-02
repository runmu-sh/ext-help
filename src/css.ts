/** The panel's stylesheet: theme tokens only, injected with mu.ui.style. */
export const CSS = `
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
