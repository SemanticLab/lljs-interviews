/* Linking Lost Jazz Shrines: interview search, reader and theme browser.
   Everything runs in the page. data/corpus.js holds every block of the 27 interviews
   (text, speaker, tagged entities); data/themes.js holds the themes found by clustering.

   Routes (hash):
     #/                      search   ?q= words "a phrase"  &e=Q71,Q657  &d=Q23378  &who=iv|ir  &sort=order
     #/read/<doc>/<n>        read an interview at block n (the block's local id)   ?q= keeps the marks
     #/interviews            the interviews
     #/entities              people, shrines, groups   ?k=person  &f=text  &sort=az
     #/themes                themes and the passage map
     #/theme/<id>            one theme
     #/about                                                                                   */
"use strict";
(() => {
  const C = window.LLJS_CORPUS;
  const TH = window.LLJS_THEMES || null;
  const app = document.getElementById("app");
  if (!C) {
    app.innerHTML = '<p class="empty">The interview data (data/corpus.js) could not be loaded.</p>';
    return;
  }

  // ------------------------------------------------------------------ small helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => n.toLocaleString("en-US");
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + "s"}`;
  const icons = {
    search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
    book: '<path d="M12 6C8 3 5 4 2 4v14c3 0 6-1 10 2 4-3 7-2 10-2V4c-3 0-6-1-10 2v14"/>',
    external: '<path d="M13 4h7v7m0-7L10 14m-1-9H4v15h15v-5"/>',
    left: '<path d="m14.5 5-7 7 7 7"/>',
    right: '<path d="m9.5 5 7 7-7 7"/>',
    up: '<path d="m5 14.5 7-7 7 7"/>',
    down: '<path d="m5 9.5 7 7 7-7"/>',
    x: '<path d="m5 5 14 14m0-14L5 19"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.700 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.200c2.800.2 5 2.600 5 5.800"/>',
    themes: '<circle cx="6" cy="7" r="2.500"/><circle cx="17" cy="6" r="2"/><circle cx="8" cy="17" r="2"/><circle cx="17" cy="16" r="3"/>',
    read: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
  };
  const icon = (k) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[k]}</svg>`;
  const ic = (k) => `<i data-icon="${k}">${icon(k)}</i>`;
  document.querySelectorAll("[data-icon]").forEach((i) => (i.innerHTML = icon(i.dataset.icon)));
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const niceDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return d ? `${d} ${MONTHS[m - 1]} ${y}` : m ? `${MONTHS[m - 1]} ${y}` : String(y);
  };

  // ------------------------------------------------------------------ data
  const E = C.entities;
  const D = C.docs;
  const B = C.blocks.map((r, i) => ({ i, id: r[0], doc: r[1], n: r[2], sp: r[3], said: r[4], text: r[5], ents: r[6] }));
  const KINDS = [
    ["person", "People", "Person"],
    ["shrine", "Jazz shrines", "Jazz shrine"],
    ["group", "Music groups", "Music group"],
    ["org", "Organizations", "Organization"],
    ["school", "Schools", "School"],
    ["place", "Places", "Place"],
    ["other", "Other terms", "Term"],
  ];
  const KIND_ONE = Object.fromEntries(KINDS.map((k) => [k[0], k[2]]));
  const entIndex = new Map(E.map((e, i) => [e.id, i]));
  const docIndex = new Map(D.map((d, i) => [d.id, i]));
  const entBlocks = E.map(() => []);
  B.forEach((b) => b.ents.forEach((e) => entBlocks[e].push(b.i)));
  D.forEach((d, i) => {
    d.i = i;
    d.asks = new Set(d.interviewers);
    d.byN = new Map();
    for (let k = d.first; k < d.first + d.count; k++) d.byN.set(String(B[k].n), k);
  });
  E.forEach((e, i) => {
    e.i = i;
    e.docs = new Set(entBlocks[i].map((b) => B[b].doc)).size;
  });
  const ASKERS = new Set(D.flatMap((d) => d.interviewers));
  const speaker = (b) => (b.sp >= 0 ? E[b.sp].label : b.said || "");
  const role = (b) => {
    if (b.sp >= 0) return D[b.doc].asks.has(b.sp) ? "ir" : "iv";
    return /interviewer/i.test(b.said) ? "ir" : b.said ? "iv" : "";
  };
  const readHref = (b, q) => `#/read/${D[b.doc].id}/${encodeURIComponent(b.n)}${q ? "?q=" + encodeURIComponent(q) : ""}`;
  const entHref = (e) => `#/?e=${e.id}`;

  // themes: passages are runs of blocks; a block inherits the theme of its passage
  const P = TH ? TH.passages.map((r, i) => ({ i, first: r[0], count: r[1], theme: r[2], core: !!r[3], x: r[4], y: r[5], related: r[6] })) : [];
  const passageOf = new Int32Array(B.length).fill(-1);
  P.forEach((p) => {
    for (let k = p.first; k < p.first + p.count; k++) passageOf[k] = p.i;
  });
  const themeById = new Map(TH ? TH.themes.map((t) => [t.id, t]) : []);
  if (!TH) document.querySelector('[data-nav="themes"]').hidden = true;
  const themeOf = (b) => {
    const p = passageOf[b.i];
    return p >= 0 && P[p].theme >= 0 ? themeById.get(P[p].theme) : null;
  };

  // ------------------------------------------------------------------ full-text index
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const TOKEN = /[\p{L}\p{N}]+/gu;
  const stem = (t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  const postings = new Map(); // stem -> [block, tf, block, tf, ...]
  let totalLen = 0;
  for (const b of B) {
    const toks = (norm(b.text).match(TOKEN) || []).map(stem);
    b.toks = toks;
    totalLen += toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push(b.i, n);
    }
  }
  const avgLen = totalLen / B.length;
  const vocab = [...postings.keys()].sort();
  const withPrefix = (pre) => {
    let lo = 0, hi = vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vocab[mid] < pre) lo = mid + 1;
      else hi = mid;
    }
    const out = [];
    for (let k = lo; k < vocab.length && vocab[k].startsWith(pre) && out.length < 300; k++) out.push(vocab[k]);
    return out;
  };

  // "a phrase" in quotes, word* for a prefix; the word being typed is a prefix too
  function parseQuery(q) {
    const parts = [];
    const text = String(q || "").replace(/[“”]/g, '"');
    const re = /"([^"]*)"?|(\S+)/g;
    let m;
    while ((m = re.exec(text))) {
      const quoted = m[1] !== undefined;
      const raw = quoted ? m[1] : m[2];
      const toks = (norm(raw).match(TOKEN) || []).map(stem);
      if (!toks.length) continue;
      parts.push({ toks, phrase: toks.length > 1, prefix: !quoted && /\*$/.test(raw), quoted });
    }
    const last = parts[parts.length - 1];
    if (last && !last.quoted && !last.phrase && !/\s$/.test(text) && last.toks[0].length >= 2) last.prefix = true;
    return parts;
  }
  const phraseCount = (toks, ph) => {
    let n = 0;
    outer: for (let i = 0; i + ph.length <= toks.length; i++) {
      for (let k = 0; k < ph.length; k++) if (toks[i + k] !== ph[k]) continue outer;
      n++;
    }
    return n;
  };
  // Map(block -> score) for the blocks that hold every part of the query (BM25)
  function textSearch(parts) {
    let acc = null;
    for (const part of parts) {
      const tf = new Map();
      if (part.phrase) {
        const lists = part.toks.map((t) => postings.get(t) || []);
        const rare = lists.reduce((a, b) => (b.length < a.length ? b : a));
        for (let k = 0; k < rare.length; k += 2) {
          const n = phraseCount(B[rare[k]].toks, part.toks);
          if (n) tf.set(rare[k], n * 1.5);
        }
      } else {
        const stems = part.prefix ? withPrefix(part.toks[0]) : [part.toks[0]];
        for (const s of stems) {
          const p = postings.get(s);
          if (!p) continue;
          const w = s === part.toks[0] ? 1 : 0.6; // the word itself counts more than a longer word that starts with it
          for (let k = 0; k < p.length; k += 2) tf.set(p[k], (tf.get(p[k]) || 0) + p[k + 1] * w);
        }
      }
      const idf = Math.log(1 + (B.length - tf.size + 0.5) / (tf.size + 0.5));
      const next = new Map();
      for (const [b, f] of tf) {
        if (acc && !acc.has(b)) continue;
        const s = (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (B[b].toks.length / avgLen)));
        next.set(b, (acc ? acc.get(b) : 0) + s);
      }
      acc = next;
    }
    return acc || new Map();
  }
  // character ranges of the query's words in a text
  function markRanges(text, parts) {
    if (!parts.length) return [];
    const toks = [];
    for (const m of text.matchAll(TOKEN)) toks.push({ s: m.index, e: m.index + m[0].length, t: stem(norm(m[0])) });
    const out = [];
    for (const part of parts) {
      if (part.phrase) {
        outer: for (let i = 0; i + part.toks.length <= toks.length; i++) {
          for (let k = 0; k < part.toks.length; k++) if (toks[i + k].t !== part.toks[k]) continue outer;
          out.push([toks[i].s, toks[i + part.toks.length - 1].e]);
        }
      } else {
        const w = part.toks[0];
        for (const t of toks) if (t.t === w || (part.prefix && t.t.startsWith(w))) out.push([t.s, t.e]);
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of out) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    return merged;
  }

  // where a block's tagged entities are named in its text: [start, end, entity]
  const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  // same length as the input, so positions carry over: lower case, plain quotes, no accents
  const fold = (x) => x.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u00c0-\u024f]/g, (ch) => ch.normalize("NFD")[0]).toLowerCase();
  function entityRanges(b) {
    if (b._er) return b._er;
    // The transcripts complete names in square brackets: "Randy [Weston]", "[Thelonious] Monk",
    // "Sista's [Place]". Names are looked for in the text without the brackets; `at` maps each
    // character of that text back to its place in the original.
    const folded = fold(b.text);
    let plain = "";
    const at = [];
    for (let i = 0; i < folded.length; i++) {
      const ch = folded[i];
      if (ch === "[" || ch === "]") continue;
      if (ch === " " && plain.endsWith(" ")) continue;
      plain += ch;
      at.push(i);
    }
    const names = [];
    const short = new Map(); // a first name or surname alone, kept only when one tagged person has it
    for (const ei of b.ents) {
      const e = E[ei];
      const set = new Set([e.label, e.label.replace(/\s*\([^)]*\)\s*/g, " ").trim(), e.label.replace(/["\u201c\u201d]/g, ""), ...(e.aliases || [])]);
      if (/^The /.test(e.label)) set.add(e.label.slice(4));
      for (const n of set) if (n.length >= 3) names.push([fold(n).replace(/[\[\]]/g, "").replace(/ +/g, " "), ei]);
      if (e.kind === "person") {
        const words = e.label.replace(/,? (Jr|Sr|III|II)\.?$/, "").replace(/\s*\([^)]*\)|"[^"]*"/g, " ").trim().split(/\s+/);
        for (const w of new Set([words[0], words[words.length - 1]])) {
          const k = fold(w || "");
          if (k.length >= 4 && words.length > 1) short.set(k, short.has(k) ? -1 : ei);
        }
      }
    }
    for (const [n, ei] of short) if (ei >= 0) names.push([n, ei]);
    names.sort((a, c) => c[0].length - a[0].length);
    const taken = [];
    for (const [n, ei] of names) {
      let from = 0, hit;
      while ((hit = plain.indexOf(n, from)) >= 0) {
        const end = hit + n.length;
        from = end;
        if (isWordChar(plain[hit - 1]) || isWordChar(plain[end])) continue;
        let s0 = at[hit], e0 = at[end - 1] + 1;
        while (folded[s0 - 1] === "[" || (folded[s0 - 1] === " " && folded[s0 - 2] === "[")) s0--;
        if (folded[e0] === "]") e0++;
        if (taken.some((r) => s0 < r[1] && e0 > r[0])) continue;
        taken.push([s0, e0, ei]);
      }
    }
    taken.sort((a, c) => a[0] - c[0]);
    return (b._er = taken);
  }
  // text as HTML with the query's words marked and, optionally, entity names linked
  function renderText(text, marks, ents, from = 0, to = text.length, named = []) {
    const cuts = new Set([from, to]);
    for (const r of marks) for (const x of [r[0], r[1]]) if (x > from && x < to) cuts.add(x);
    for (const r of named) for (const x of [r[0], r[1]]) if (x > from && x < to) cuts.add(x);
    for (const r of ents || []) for (const x of [r[0], r[1]]) if (x > from && x < to) cuts.add(x);
    const pts = [...cuts].sort((a, b) => a - b);
    let html = "";
    for (let k = 0; k + 1 < pts.length; k++) {
      const s = pts[k], e = pts[k + 1];
      let piece = esc(text.slice(s, e));
      if (named.some((r) => s >= r[0] && e <= r[1])) piece = `<mark class="named">${piece}</mark>`;
      else if (marks.some((r) => s >= r[0] && e <= r[1])) piece = `<mark>${piece}</mark>`;
      const en = ents && ents.find((r) => s >= r[0] && e <= r[1]);
      if (en) piece = `<a class="ent k-${E[en[2]].kind}" href="${entHref(E[en[2]])}" data-ent="${en[2]}">${piece}</a>`;
      html += piece;
    }
    return html;
  }
  // ends of sentences, for cutting a preview where a reader would
  const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Rev|Ave|Blvd|Mt|Ft|vs|No)|\b[A-Z])\.$/;
  const sentenceEnd = (text, at, reach = 420) => {
    const part = text.slice(at, at + reach);
    for (const m of part.matchAll(/[.!?\u2026]+["\u201d\u2019)\]]*(?=\s)|\n/g)) {
      if (m[0] === "\n") return at + m.index;
      if (ABBR.test(part.slice(0, m.index + 1))) continue;       // "Dr." and "St." do not end a sentence
      return at + m.index + m[0].length;
    }
    return Math.min(text.length, at + reach);
  };
  const sentenceStart = (text, at, reach = 320) => {
    const back = text.slice(Math.max(0, at - reach), at);
    let cut = -1;
    for (const m of back.matchAll(/[.!?\u2026]+["\u201d\u2019)\]]*\s+|\n+/g)) cut = m.index + m[0].length;
    return cut >= 0 ? at - back.length + cut : Math.max(0, at - reach);
  };
  // A preview of a block. With a query: the stretch that holds the most matched words. With an
  // entity filter: the text from the start up to where each picked entity is first named, and
  // the sentence after it; when the name is far into a long block the middle is left out.
  const NEAR = 1200;
  function snippet(b, parts, picked = [], max = 460) {
    const text = b.text;
    const marks = markRanges(text, parts);
    const mentions = picked.length ? entityRanges(b).filter((r) => picked.includes(r[2])) : [];
    if (text.length <= max) return renderText(text, marks, null, 0, text.length, mentions);
    const spans = [];
    if (marks.length) {
      // the window of `max` characters that holds the most marked words
      let best = -1, from = 0;
      for (const r of marks) {
        const start = Math.max(0, r[0] - 90);
        const n = marks.filter((x) => x[0] >= start && x[1] <= start + max).length;
        if (n > best) (best = n), (from = start);
      }
      spans.push([from, Math.min(text.length, from + max)]);
    }
    for (const e of picked) {
      const r = mentions.find((x) => x[2] === e);
      if (r) spans.push([sentenceStart(text, r[0]), sentenceEnd(text, sentenceEnd(text, r[1]) + 1)]);
    }
    if (!spans.length) spans.push([0, max]);
    if (mentions.length) {
      const first = Math.min(...spans.map((x) => x[0]));
      spans.push([0, first <= NEAR ? first : sentenceEnd(text, 160, 200)]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + 60) last[1] = Math.max(last[1], sp[1]);
      else merged.push([sp[0], Math.min(text.length, sp[1])]);
    }
    const sentenceEdge = (i) => i <= 0 || i >= text.length || /[.!?\u2026"\u201d\u2019)\]\n]\s*$/.test(text.slice(Math.max(0, i - 3), i)) || text[i] === "\n";
    let html = "";
    merged.forEach(([from, to], k) => {
      if (from > 0 && !sentenceEdge(from)) {      // not on a sentence: start on a whole word
        const sp = text.indexOf(" ", from);
        if (sp >= 0 && sp < from + 40) from = sp + 1;
      }
      if (to < text.length && !sentenceEdge(to)) {
        const sp = text.lastIndexOf(" ", to);
        if (sp > to - 40 && sp > from) to = sp;
      }
      html += (k ? '<span class="gap"> \u2026 </span>' : from > 0 ? "\u2026 " : "") + renderText(text, marks, null, from, to, mentions).trim();
      if (k === merged.length - 1 && to < text.length) html += " \u2026";
    });
    return html;
  }

  // ------------------------------------------------------------------ shared bits of page
  const chip = (e, extra = "") => `<a class="chip k-${e.kind}" href="${entHref(e)}" data-ent="${e.i}" title="${esc(KIND_ONE[e.kind])}">${esc(e.label)}${extra}</a>`;
  const themeChip = (t) => (t ? `<a class="chip theme" href="#/theme/${t.id}">${ic("themes")}${esc(t.name)}</a>` : "");
  const blockItem = (b) => `https://base.semlab.io/wiki/Item:${b.id}`;
  const portrait = (e) => (e.img ? `<img class="portrait" src="${esc(e.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : "");

  // entity tooltip (the name, what it is, how often it is tagged)
  const tip = document.getElementById("tip");
  const showTip = (el, html) => {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    tip.style.top = (r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8) + "px";
  };
  document.addEventListener("mouseover", (ev) => {
    const a = ev.target.closest && ev.target.closest("a.ent[data-ent]");
    if (!a) return;
    const e = E[+a.dataset.ent];
    showTip(a, `<b>${esc(e.label)}</b><span>${esc(KIND_ONE[e.kind])}${e.desc ? " · " + esc(e.desc) : ""}</span><span>Tagged in ${plural(e.n, "block")} of ${plural(e.docs, "interview")}</span>`);
  });
  document.addEventListener("mouseout", (ev) => {
    if (ev.target.closest && ev.target.closest("a.ent[data-ent], [data-pt]")) tip.hidden = true;
  });

  // ------------------------------------------------------------------ router
  let lastSearch = ""; // the hash of the last search, for "Back to results"
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const cut = h.indexOf("?");
    const seg = (cut < 0 ? h : h.slice(0, cut)).split("/").filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(cut < 0 ? "" : h.slice(cut + 1));
    return { seg, params };
  }
  function setNav(name) {
    document.querySelectorAll("#nav [data-nav]").forEach((a) => a.classList.toggle("current", a.dataset.nav === name));
  }
  let current = null; // the view on screen: { name, update(route) }
  function render() {
    const r = route();
    const name = r.seg[0] || "search";
    tip.hidden = true;
    if (current && current.name === name && current.update && current.update(r)) return;
    current = null;
    if (name === "read") current = readView(r);
    else if (name === "interviews") current = interviewsView();
    else if (name === "entities") current = entitiesView(r);
    else if (name === "themes" && TH) current = themesView();
    else if (name === "theme" && TH) current = themeView(r);
    else if (name === "about") current = aboutView();
    else current = searchView(r);
  }
  window.addEventListener("hashchange", render);

  // ------------------------------------------------------------------ search
  function searchView(r0) {
    setNav("search");
    document.title = "Linking Lost Jazz Shrines";
    const st = { q: "", ents: [], docs: [], who: "", sort: "", shown: 30 };
    const read = (r) => {
      st.q = r.params.get("q") || "";
      st.ents = (r.params.get("e") || "").split(",").map((q) => entIndex.get(q)).filter((x) => x !== undefined);
      st.docs = (r.params.get("d") || "").split(",").map((q) => docIndex.get(q)).filter((x) => x !== undefined);
      st.who = r.params.get("who") || "";
      st.sort = r.params.get("sort") || "";
      st.shown = 30;
    };
    read(r0);
    const hashOf = () => {
      const p = [];
      if (st.q.trim()) p.push("q=" + encodeURIComponent(st.q));
      if (st.ents.length) p.push("e=" + st.ents.map((i) => E[i].id).join(","));
      if (st.docs.length) p.push("d=" + st.docs.map((i) => D[i].id).join(","));
      if (st.who) p.push("who=" + st.who);
      if (st.sort) p.push("sort=" + st.sort);
      return "#/" + (p.length ? "?" + p.join("&") : "");
    };
    let own = ""; // a hash this view wrote itself: no re-read needed
    const push = (replace) => {
      own = hashOf();
      if (location.hash === own || (own === "#/" && !location.hash)) return;
      if (replace) history.replaceState(null, "", own);
      else history.pushState(null, "", own);
    };

    app.innerHTML = `
      <section class="search-head">
        <h1>Search the interviews</h1>
        <label class="bigsearch">${ic("search")}<input id="q" type="search" autocomplete="off" spellcheck="false"
          placeholder="A club, a street, a name, or &quot;an exact phrase&quot;" aria-label="Search the interview text" /></label>
        <p class="hint">${num(B.length)} blocks of ${D.length} interviews, searched in your browser. Put a phrase in quotation marks; end a word with * to match its beginning.</p>
      </section>
      <div class="cols">
        <aside class="rail" aria-label="Filters">
          <section class="facet">
            <h2>Filter by people &amp; places</h2>
            <div id="picked" class="picked"></div>
            <div class="combo">
              <input id="entq" type="search" autocomplete="off" placeholder="Add a person, shrine or group" aria-label="Find an entity to filter by" />
              <ul id="entsug" class="sug" hidden></ul>
            </div>
            <div id="entfacets"></div>
          </section>
          <section class="facet">
            <h2>Who is speaking</h2>
            <div class="seg" id="who" role="group" aria-label="Who is speaking">
              <button data-who="">Anyone</button><button data-who="iv">Interviewees</button><button data-who="ir">Interviewers</button>
            </div>
          </section>
          <section class="facet">
            <h2>Interviews</h2>
            <ul id="docfacet" class="doclist"></ul>
          </section>
        </aside>
        <section class="results" aria-live="polite">
          <div id="entcard"></div>
          <div class="results-bar"><p id="count"></p><div id="tools"></div></div>
          <div id="maybe"></div>
          <ol id="hits" class="hits"></ol>
          <div id="more"></div>
        </section>
      </div>`;
    const $ = (id) => document.getElementById(id);
    const qEl = $("q");
    qEl.value = st.q;

    function compute() {
      const parts = parseQuery(st.q);
      const scores = parts.length ? textSearch(parts) : null;
      let ids = scores ? [...scores.keys()] : B.map((b) => b.i);
      if (st.ents.length) {
        const sets = st.ents.map((e) => new Set(entBlocks[e]));
        ids = ids.filter((i) => sets.every((s) => s.has(i)));
      }
      if (st.who) ids = ids.filter((i) => role(B[i]) === st.who);
      const base = ids; // before the interview filter, so the interview counts stay comparable
      if (st.docs.length) {
        const ds = new Set(st.docs);
        ids = ids.filter((i) => ds.has(B[i].doc));
      }
      const byOrder = !scores || st.sort === "order";
      ids.sort(byOrder ? (a, b) => a - b : (a, b) => scores.get(b) - scores.get(a) || a - b);
      return { parts, scores, ids, base };
    }

    function paint() {
      const active = !!(st.q.trim() || st.ents.length || st.docs.length || st.who);
      const res = compute();
      lastSearch = active ? hashOf() : "";

      // picked entities
      $("picked").innerHTML = st.ents.map((i) => `<button class="chip k-${E[i].kind} on" data-drop="${i}" title="Remove this filter">${esc(E[i].label)}${ic("x")}</button>`).join("");
      // who
      $("who").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.who === st.who)));
      // interviews
      const perDoc = new Map();
      for (const i of res.base) perDoc.set(B[i].doc, (perDoc.get(B[i].doc) || 0) + 1);
      $("docfacet").innerHTML = D.map((d) => {
        const n = perDoc.get(d.i) || 0;
        const on = st.docs.includes(d.i);
        return `<li><button data-doc="${d.i}" aria-pressed="${on}" ${n || on ? "" : "disabled"}><span>${esc(d.name)}</span><b>${num(n)}</b></button></li>`;
      }).join("");
      // entities in these results
      const tally = new Map();
      for (const i of res.ids) for (const e of B[i].ents) tally.set(e, (tally.get(e) || 0) + 1);
      const groups = [["person", "People"], ["shrine", "Jazz shrines"], ["group", "Groups &amp; organizations"]];
      $("entfacets").innerHTML = groups.map(([k, title]) => {
        const rows = [...tally].filter(([e]) => !st.ents.includes(e) && !ASKERS.has(e) && (E[e].kind === k || (k === "group" && ["org", "school", "place"].includes(E[e].kind))))
          .sort((a, b) => b[1] - a[1] || E[a[0]].label.localeCompare(E[b[0]].label)).slice(0, 8);
        if (!rows.length) return "";
        return `<h3>${title} <span>${active ? "in these results" : "most tagged"}</span></h3><ul class="entlist">${rows.map(([e, n]) =>
          `<li><button data-add="${e}"><span>${esc(E[e].label)}</span><b>${num(n)}</b></button></li>`).join("")}</ul>`;
      }).join("");

      // one entity picked: say what it is
      $("entcard").innerHTML = st.ents.length === 1 ? entityCard(E[st.ents[0]]) : "";

      // the query names an entity: offer the tag as a filter
      let maybe = "";
      const qn = norm(st.q.replace(/["*]/g, "")).trim();
      if (qn.length >= 3) {
        const hits = E.filter((e) => e.n && !st.ents.includes(e.i) && (norm(e.label).includes(qn) || (e.aliases || []).some((a) => norm(a).includes(qn))))
          .sort((a, b) => (norm(b.label).startsWith(qn) - norm(a.label).startsWith(qn)) || b.n - a.n).slice(0, 4);
        if (hits.length) maybe = `<p class="maybe">Tagged in the interviews: ${hits.map((e) =>
          `<button class="chip k-${e.kind}" data-swap="${e.i}" title="Show the ${num(e.n)} blocks tagged with this ${esc(KIND_ONE[e.kind].toLowerCase())}">${esc(e.label)} <b>${num(e.n)}</b></button>`).join("")}</p>`;
      }
      $("maybe").innerHTML = maybe;

      if (!active) {
        $("count").textContent = "";
        $("tools").innerHTML = "";
        $("hits").innerHTML = "";
        $("more").innerHTML = welcome();
        return;
      }
      const nDocs = new Set(res.ids.map((i) => B[i].doc)).size;
      $("count").innerHTML = res.ids.length ? `<b>${plural(res.ids.length, "block")}</b> in ${plural(nDocs, "interview")}` : "<b>No blocks match.</b>";
      $("tools").innerHTML = `${res.scores && res.ids.length > 1 ? `<label class="sort">Order <select id="sort"><option value="">Best match</option><option value="order"${st.sort === "order" ? " selected" : ""}>Interview order</option></select></label>` : ""}
        <button class="plain" id="clear">Clear all</button>`;
      const page = res.ids.slice(0, st.shown).map((i) => B[i]);
      $("hits").innerHTML = page.map((b) => hitCard(b, res.parts, st.q, st.ents)).join("");
      $("more").innerHTML = res.ids.length > st.shown ? `<button class="morebtn" id="showmore">Show ${num(Math.min(30, res.ids.length - st.shown))} more ${ic("down")}</button>`
        : res.ids.length ? "" : `<p class="empty">Try fewer words, another spelling, or remove a filter. Names in the transcripts are sometimes spelled as heard.</p>`;
    }

    function welcome() {
      const top = (k, n) => E.filter((e) => e.kind === k && e.n).slice(0, n);
      const people = E.filter((e) => e.kind === "person" && e.n && !ASKERS.has(e.i)).slice(0, 14);
      const themes = TH ? TH.themes.filter((t) => t.kind !== "meta").slice().sort((a, b) => b.coherence - a.coherence || b.size - a.size).slice(0, 6) : [];
      return `<div class="welcome">
        <p class="lede">Between 2008 and 2010 the Weeksville Heritage Center recorded musicians, club owners, organizers and listeners
        talking about jazz in central Brooklyn. These are their ${D.length} interviews, cut into ${num(B.length)} blocks, with every person,
        club and organization that the project team identified in them.</p>
        <div class="starts">
          <section><h2>Jazz shrines</h2><p class="chips">${top("shrine", 16).map((e) => chip(e, ` <b>${num(e.n)}</b>`)).join("")}</p>
            <a class="go" href="#/entities?k=shrine">All ${num(E.filter((e) => e.kind === "shrine" && e.n).length)} shrines ${ic("right")}</a></section>
          <section><h2>People</h2><p class="chips">${people.map((e) => chip(e, ` <b>${num(e.n)}</b>`)).join("")}</p>
            <a class="go" href="#/entities?k=person">All ${num(E.filter((e) => e.kind === "person" && e.n).length)} people ${ic("right")}</a></section>
          ${themes.length ? `<section><h2>Themes</h2><ul class="minithemes">${themes.map((t) => `<li><a href="#/theme/${t.id}">${esc(t.name)}</a><span>${plural(t.size, "passage")}</span></li>`).join("")}</ul>
            <a class="go" href="#/themes">All ${TH.themes.length} themes ${ic("right")}</a></section>` : ""}
          <section><h2>Try</h2><p class="chips">${['"jam session"', "Fulton Street", "cabaret card", '"The East"', "organ trio", "Blue Coronet"].map((q) =>
            `<a class="chip q" href="#/?q=${encodeURIComponent(q)}">${esc(q)}</a>`).join("")}</p>
            <a class="go" href="#/interviews">Read an interview from the start ${ic("right")}</a></section>
        </div></div>`;
    }

    // ---- events
    let timer = 0;
    qEl.addEventListener("input", () => {
      st.q = qEl.value;
      st.shown = 30;
      paint();
      clearTimeout(timer);
      timer = setTimeout(() => push(true), 350);
    });
    qEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        clearTimeout(timer);
        push(false);
      }
    });
    const change = () => {
      st.shown = 30;
      paint();
      push(false);
    };
    app.addEventListener("click", (ev) => {
      const t = ev.target.closest("button, a");
      if (!t || current !== view) return;
      if (t.dataset.add !== undefined) st.ents.push(+t.dataset.add), change();
      else if (t.dataset.drop !== undefined) (st.ents = st.ents.filter((e) => e !== +t.dataset.drop)), change();
      else if (t.dataset.swap !== undefined) (st.q = ""), (qEl.value = ""), st.ents.push(+t.dataset.swap), change();
      else if (t.dataset.doc !== undefined) {
        const d = +t.dataset.doc;
        st.docs = st.docs.includes(d) ? st.docs.filter((x) => x !== d) : [...st.docs, d];
        change();
      } else if (t.dataset.who !== undefined) (st.who = t.dataset.who), change();
      else if (t.id === "clear") (st.q = ""), (qEl.value = ""), (st.ents = []), (st.docs = []), (st.who = ""), (st.sort = ""), change();
      else if (t.id === "showmore") (st.shown += 30), paint();
    });
    app.addEventListener("change", (ev) => {
      if (ev.target.id === "sort") (st.sort = ev.target.value), change();
    });
    // entity type-ahead
    const entq = $("entq"), sug = $("entsug");
    let sugItems = [], sugAt = -1;
    const paintSug = () => {
      const q = norm(entq.value).trim();
      if (!q) return (sug.hidden = true);
      sugItems = E.filter((e) => e.n && !st.ents.includes(e.i) && (norm(e.label).includes(q) || (e.aliases || []).some((a) => norm(a).includes(q))))
        .sort((a, b) => (norm(b.label).startsWith(q) - norm(a.label).startsWith(q)) || b.n - a.n).slice(0, 8);
      sugAt = sugItems.length ? 0 : -1;
      sug.innerHTML = sugItems.length ? sugItems.map((e, k) => `<li><button data-pick="${e.i}" class="${k === sugAt ? "at" : ""}"><span>${esc(e.label)}<small>${esc(KIND_ONE[e.kind])}</small></span><b>${num(e.n)}</b></button></li>`).join("")
        : `<li class="none">Nothing tagged with that name.</li>`;
      sug.hidden = false;
    };
    const pick = (i) => {
      entq.value = "";
      sug.hidden = true;
      st.ents.push(i);
      change();
    };
    entq.addEventListener("input", paintSug);
    entq.addEventListener("focus", paintSug);
    entq.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 150));
    entq.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!sugItems.length) return;
        sugAt = (sugAt + (ev.key === "ArrowDown" ? 1 : -1) + sugItems.length) % sugItems.length;
        sug.querySelectorAll("button").forEach((b, k) => b.classList.toggle("at", k === sugAt));
      } else if (ev.key === "Enter" && sugAt >= 0) pick(sugItems[sugAt].i);
      else if (ev.key === "Escape") sug.hidden = true;
    });
    sug.addEventListener("mousedown", (ev) => {
      const b = ev.target.closest("[data-pick]");
      if (b) ev.preventDefault(), pick(+b.dataset.pick);
    });

    paint();
    window.scrollTo(0, 0);
    const view = {
      name: "search",
      update(r) {
        if (location.hash === own || (!location.hash && own === "#/")) return true;
        read(r);
        qEl.value = st.q;
        paint();
        window.scrollTo(0, 0);
        return true;
      },
    };
    return view;
  }

  function entityCard(e) {
    const tally = new Map();
    for (const i of entBlocks[e.i]) for (const x of B[i].ents) if (x !== e.i) tally.set(x, (tally.get(x) || 0) + 1);
    const near = [...tally].filter(([x]) => !ASKERS.has(x)).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return `<section class="entcard k-${e.kind}">
      ${portrait(e)}
      <div><p class="eyebrow">${esc(KIND_ONE[e.kind])}</p><h2>${esc(e.label)}</h2>
      ${e.desc ? `<p class="desc">${esc(e.desc)}</p>` : ""}
      <p class="small">Tagged in ${plural(e.n, "block")} of ${plural(e.docs, "interview")}.
        <a href="https://base.semlab.io/wiki/Item:${e.id}" target="_blank" rel="noreferrer">Wikibase item ${e.id} ${ic("external")}</a>
        ${e.wd ? `<a href="https://www.wikidata.org/wiki/${esc(e.wd)}" target="_blank" rel="noreferrer">Wikidata ${ic("external")}</a>` : ""}</p>
      ${near.length ? `<p class="chips"><span class="lab">Often in the same block</span>${near.map(([x, n]) => `<button class="chip k-${E[x].kind}" data-add="${x}" title="Narrow to blocks that also tag this">${esc(E[x].label)} <b>${n}</b></button>`).join("")}</p>` : ""}
      </div></section>`;
  }

  function hitCard(b, parts, q, picked) {
    const d = D[b.doc];
    const t = themeOf(b);
    const tagged = b.ents.filter((e) => e !== b.sp);
    const shown = tagged.slice(0, 9);
    return `<li class="hit ${role(b)}">
      <p class="where"><a href="${readHref(b, q)}"><b>${esc(d.name)}</b> <span>block ${esc(b.n)}</span></a>${speaker(b) ? `<span class="spk">${esc(speaker(b))}</span>` : ""}</p>
      <p class="tx">${snippet(b, parts, picked)}</p>
      <p class="chips">${shown.map((e) => chip(E[e])).join("")}${tagged.length > shown.length ? `<span class="morechips">+${tagged.length - shown.length}</span>` : ""}${themeChip(t)}
        <a class="go" href="${readHref(b, q)}">Read from here ${ic("right")}</a></p></li>`;
  }

  // ------------------------------------------------------------------ reader
  function readView(r0) {
    setNav("interviews");
    const d = D[docIndex.get(r0.seg[1])];
    if (!d) {
      app.innerHTML = `<p class="empty">There is no interview with the id ${esc(r0.seg[1] || "")}. <a href="#/interviews">See the interviews</a>.</p>`;
      return { name: "read" };
    }
    document.title = `${d.name} · Linking Lost Jazz Shrines`;
    const first = d.first, last = d.first + d.count - 1;
    let q = "", parts = [], target = first, lo = first, hi = first, whole = false;
    const spanFor = (from, dir, chars) => {
      let k = from, n = 0;
      while (k + dir >= first && k + dir <= last && n < chars) (k += dir), (n += B[k].text.length + 40);
      return k;
    };
    const names = (ids) => ids.map((i) => chip(E[i])).join("");
    app.innerHTML = `<article class="reader">
      <header class="doc-head">
        <p class="eyebrow">Interview${d.date ? " · recorded " + niceDate(d.date) : ""}</p>
        <h1>${esc(d.name)}</h1>
        <dl class="meta">
          <div><dt>${d.interviewees.length > 1 ? "Interviewees" : "Interviewee"}</dt><dd class="chips">${names(d.interviewees)}</dd></div>
          <div><dt>${d.interviewers.length > 1 ? "Interviewers" : "Interviewer"}</dt><dd class="chips">${names(d.interviewers)}</dd></div>
        </dl>
        <p class="doc-links"><a id="back" href="#/" hidden>${ic("left")} Back to results</a>
          <a href="#/?d=${d.id}">${ic("search")} Search this interview</a>
          <a href="https://base.semlab.io/wiki/Item:${d.id}" target="_blank" rel="noreferrer">Wikibase item ${d.id} ${ic("external")}</a>
          ${d.source ? `<a href="${esc(d.source)}" target="_blank" rel="noreferrer">Project page (archived) ${ic("external")}</a>` : ""}</p>
      </header>
      <div class="where-bar" id="wherebar"><div class="track"><i id="wherefill"></i><b id="wheredot"></b></div>
        <p><span id="wheretext"></span><button class="plain" id="whole"></button></p></div>
      <div id="top"></div>
      <div id="turns" class="turns"></div>
      <div id="bottom"></div>
    </article>`;
    const $ = (id) => document.getElementById(id);
    const turns = $("turns");

    const turnHtml = (b) => {
      const isT = b.i === target;
      const t = themeOf(b);
      let foot = "";
      if (isT) {
        const p = passageOf[b.i] >= 0 ? P[passageOf[b.i]] : null;
        const rel = p ? p.related.map((x) => P[x]).filter(Boolean) : [];
        foot = `<div class="turn-foot">
          ${b.ents.length ? `<p class="chips"><span class="lab">Tagged</span>${b.ents.map((e) => chip(E[e])).join("")}</p>` : ""}
          <p class="chips">${t ? `<span class="lab">Theme</span>${themeChip(t)}` : ""}
            <a class="go" href="${blockItem(b)}" target="_blank" rel="noreferrer">Block ${esc(b.n)} on the Wikibase (${b.id}) ${ic("external")}</a></p>
          ${rel.length ? `<div class="related"><h3>Similar passages in other interviews</h3><ul>${rel.map((x) => {
            const fb = B[x.first];
            const long = B.slice(x.first, x.first + x.count).reduce((a, c) => (c.text.length > a.text.length ? c : a));
            return `<li><a href="${readHref(long)}"><b>${esc(D[fb.doc].name)}</b> <span>block ${esc(long.n)}</span></a><span class="rx">${esc(long.text.slice(0, 170))}${long.text.length > 170 ? "…" : ""}</span></li>`;
          }).join("")}</ul></div>` : ""}
        </div>`;
      }
      return `<div class="turn ${role(b)}${isT ? " target" : ""}" id="b${b.i}" data-i="${b.i}">
        <a class="bn" href="${readHref(b, q)}" title="Block ${esc(b.n)}: select it and get its link">${esc(b.n)}</a>
        <div class="turn-main"><p class="spk">${esc(speaker(b))}</p>
        <div class="tx">${renderText(b.text, markRanges(b.text, parts), entityRanges(b))}</div>${foot}</div></div>`;
    };
    const range = (a, z) => {
      let h = "";
      for (let k = a; k <= z; k++) h += turnHtml(B[k]);
      return h;
    };
    const paintEdges = () => {
      $("top").innerHTML = lo > first ? `<button class="morebtn" id="earlier">${ic("up")} Read earlier <span>${plural(lo - first, "block")} before this</span></button>` : `<p class="edge">Start of the interview</p>`;
      $("bottom").innerHTML = hi < last ? `<button class="morebtn" id="later">Keep reading ${ic("down")} <span>${plural(last - hi, "block")} to go</span></button>` : `<p class="edge">End of the interview</p>`;
      const total = d.count;
      $("wherefill").style.left = ((lo - first) / total) * 100 + "%";
      $("wherefill").style.width = Math.max(0.6, ((hi - lo + 1) / total) * 100) + "%";
      $("wheredot").style.left = ((target - first + 0.5) / total) * 100 + "%";
      $("wheretext").textContent = lo === first && hi === last ? `All ${num(total)} blocks` : `Blocks ${B[lo].n} to ${B[hi].n} of ${num(total)}`;
      $("whole").textContent = lo === first && hi === last ? "" : "Show the whole interview";
      $("whole").hidden = lo === first && hi === last;
      if (observer) {
        observer.disconnect();
        const later = $("later");
        if (later) observer.observe(later);
      }
    };
    const extendDown = () => {
      if (hi >= last) return;
      const to = spanFor(hi, 1, 3000);
      turns.insertAdjacentHTML("beforeend", range(hi + 1, to));
      hi = to;
      paintEdges();
    };
    const extendUp = () => {
      if (lo <= first) return;
      const to = spanFor(lo, -1, 3000);
      const anchor = turns.firstElementChild;
      const before = anchor.getBoundingClientRect().top;
      turns.insertAdjacentHTML("afterbegin", range(to, lo - 1));
      lo = to;
      paintEdges();
      window.scrollBy(0, anchor.getBoundingClientRect().top - before);
    };
    // keep reading: the next blocks arrive as the end of the text nears
    const observer = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && extendDown(), { rootMargin: "500px" }) : null;

    function open(r, scroll = true) {
      q = r.params.get("q") || "";
      parts = parseQuery(q).map((p) => ({ ...p, prefix: false }));
      const want = d.byN.get(String(r.seg[2] ?? ""));
      const fromStart = want === undefined;
      target = fromStart ? first : want;
      if (whole) (lo = first), (hi = last);
      else (lo = fromStart ? first : spanFor(target, -1, 1100)), (hi = spanFor(target, 1, fromStart ? 5000 : 2600));
      turns.innerHTML = range(lo, hi);
      paintEdges();
      $("back").hidden = !lastSearch;
      if (lastSearch) $("back").href = lastSearch;
      if (scroll) {
        if (fromStart) window.scrollTo(0, 0);
        else document.getElementById("b" + target).scrollIntoView({ block: "center" });
      }
    }
    app.addEventListener("click", (ev) => {
      if (current !== view) return;
      const t = ev.target.closest("button");
      if (!t) return;
      if (t.id === "earlier") extendUp();
      else if (t.id === "later") extendDown();
      else if (t.id === "whole") {
        whole = true;
        const y = document.getElementById("b" + target).getBoundingClientRect().top;
        turns.innerHTML = range(first, last);
        (lo = first), (hi = last);
        paintEdges();
        window.scrollBy(0, document.getElementById("b" + target).getBoundingClientRect().top - y);
      }
    });
    const view = {
      name: "read",
      update(r) {
        if (docIndex.get(r.seg[1]) !== d.i) return false;
        const want = d.byN.get(String(r.seg[2] ?? ""));
        const newQ = r.params.get("q") || "";
        if (want !== undefined && want >= lo && want <= hi && newQ === q) {
          // a block already on the page: move the selection without redrawing the rest
          const old = target;
          target = want;
          for (const k of new Set([old, want])) document.getElementById("b" + k).outerHTML = turnHtml(B[k]);
          paintEdges();
          const el = document.getElementById("b" + want);
          const box = el.getBoundingClientRect();
          if (box.top < 70 || box.top > window.innerHeight * 0.7) el.scrollIntoView({ block: "center", behavior: "smooth" });
          return true;
        }
        open(r);
        return true;
      },
    };
    open(r0);
    return view;
  }

  // ------------------------------------------------------------------ interviews
  function interviewsView() {
    setNav("interviews");
    document.title = "Interviews · Linking Lost Jazz Shrines";
    const words = (d) => {
      let n = 0;
      for (let k = d.first; k < d.first + d.count; k++) n += B[k].toks.length;
      return n;
    };
    app.innerHTML = `<header class="page-head"><h1>Interviews</h1>
      <p class="lede">${D.length} oral histories recorded for the Weeksville Heritage Center, most of them by Willard Jenkins in 2010. Open one to read it from the start, or search inside it.</p></header>
      <ul class="cards docs">${D.map((d) => {
        const tally = new Map();
        for (let k = d.first; k < d.first + d.count; k++) for (const e of B[k].ents) if (E[e].kind === "shrine") tally.set(e, (tally.get(e) || 0) + 1);
        const top = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 5);
        return `<li class="card"><p class="eyebrow">${d.date ? niceDate(d.date) : "Date not recorded"}</p>
          <h2><a href="#/read/${d.id}/${encodeURIComponent(B[d.first].n)}">${esc(d.name)}</a></h2>
          <p class="small">With ${d.interviewers.map((i) => esc(E[i].label)).join(" and ")} · ${plural(d.count, "block")} · about ${num(Math.round(words(d) / 100) * 100)} words</p>
          ${top.length ? `<p class="chips">${top.map(([e]) => chip(E[e])).join("")}</p>` : ""}
          <p class="card-links"><a class="go" href="#/read/${d.id}/${encodeURIComponent(B[d.first].n)}">Read ${ic("right")}</a><a class="go" href="#/?d=${d.id}">Search inside ${ic("search")}</a></p></li>`;
      }).join("")}</ul>`;
    window.scrollTo(0, 0);
    return { name: "interviews" };
  }

  // ------------------------------------------------------------------ entities
  function entitiesView(r0) {
    setNav("entities");
    document.title = "People & places · Linking Lost Jazz Shrines";
    const st = { k: r0.params.get("k") || "", f: r0.params.get("f") || "", sort: r0.params.get("sort") || "" };
    const all = E.filter((e) => e.n);
    app.innerHTML = `<header class="page-head"><h1>People &amp; places</h1>
      <p class="lede">The ${num(all.length)} people, jazz shrines, groups and organizations that the project team tagged in the interviews. Choose one to see every block that mentions it.</p></header>
      <div class="ent-tools">
        <div class="seg wrap-seg" id="kinds" role="group" aria-label="Kind"></div>
        <label class="filterbox">${ic("search")}<input id="entfilter" type="search" placeholder="Filter by name" aria-label="Filter by name" autocomplete="off" /></label>
        <label class="sort">Order <select id="entsort"><option value="">Most tagged</option><option value="az">A to Z</option></select></label>
      </div>
      <p id="entcount" class="small"></p>
      <ul id="entgrid" class="entgrid"></ul>`;
    const $ = (id) => document.getElementById(id);
    $("entfilter").value = st.f;
    $("entsort").value = st.sort;
    const paint = () => {
      const f = norm(st.f).trim();
      $("kinds").innerHTML = [["", "All"], ...KINDS.map((k) => [k[0], k[1]])].map(([k, label]) => {
        const n = k ? all.filter((e) => e.kind === k).length : all.length;
        return n ? `<button data-k="${k}" aria-pressed="${st.k === k}">${label} <b>${num(n)}</b></button>` : "";
      }).join("");
      let rows = all.filter((e) => (!st.k || e.kind === st.k) && (!f || norm(e.label).includes(f) || (e.aliases || []).some((a) => norm(a).includes(f))));
      rows = rows.slice().sort(st.sort === "az" ? (a, b) => a.label.localeCompare(b.label) : (a, b) => b.n - a.n || a.label.localeCompare(b.label));
      $("entcount").textContent = rows.length === all.length ? "" : `${num(rows.length)} shown`;
      $("entgrid").innerHTML = rows.map((e) => `<li><a class="entrow k-${e.kind}" href="${entHref(e)}">
        <span class="dot"></span><span class="nm"><b>${esc(e.label)}</b>${e.desc ? `<small>${esc(e.desc)}</small>` : `<small>${esc(KIND_ONE[e.kind])}</small>`}</span>
        <span class="ct"><b>${num(e.n)}</b><small>${e.docs} ${e.docs === 1 ? "interview" : "interviews"}</small></span></a></li>`).join("") || `<li class="empty">Nothing matches.</li>`;
      const p = [];
      if (st.k) p.push("k=" + st.k);
      if (st.f) p.push("f=" + encodeURIComponent(st.f));
      if (st.sort) p.push("sort=" + st.sort);
      history.replaceState(null, "", "#/entities" + (p.length ? "?" + p.join("&") : ""));
    };
    $("kinds").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-k]");
      if (b) (st.k = b.dataset.k), paint();
    });
    $("entfilter").addEventListener("input", (ev) => ((st.f = ev.target.value), paint()));
    $("entsort").addEventListener("change", (ev) => ((st.sort = ev.target.value), paint()));
    paint();
    window.scrollTo(0, 0);
    return { name: "entities" };
  }

  // ------------------------------------------------------------------ themes
  const groupOf = (t) => TH.groups.find((g) => g.id === t.group);
  function themesView() {
    setNav("themes");
    document.title = "Themes · Linking Lost Jazz Shrines";
    const themed = P.filter((p) => p.theme >= 0).length;
    app.innerHTML = `<header class="page-head"><h1>Themes</h1>
      <p class="lede">What the interviews keep coming back to. The transcripts were cut into ${num(P.length)} passages, a question with its answer;
      passages that talk about the same thing were grouped by a language model's reading of them, and each group was then read and described.
      ${num(themed)} passages fall in one of ${TH.themes.length} themes. <a href="#/about">How this was made</a>.</p></header>
      <section class="mapcard">
        <div class="plot"><div class="plot-bar"><div><span class="plot-caption">Map of passages</span><h2 id="mapname">Every dot is a passage; near dots talk about similar things</h2></div></div>
          <svg id="map" viewBox="0 0 1000 560" role="img" aria-label="Map of interview passages coloured by theme group"></svg></div>
        <div class="legend" id="legend"></div>
      </section>
      <div id="groups"></div>`;
    const svg = document.getElementById("map");
    const X = (p) => 28 + p.x * 944, Y = (p) => 62 + (1 - p.y) * 476;
    const colour = (p) => (p.theme >= 0 ? groupOf(themeById.get(p.theme)).colour : "#5d6f68");
    svg.innerHTML = P.slice().sort((a, b) => (a.theme >= 0) - (b.theme >= 0)).map((p) =>
      `<circle data-pt="${p.i}" data-theme="${p.theme}" cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="${p.theme >= 0 ? 5 : 3.2}" fill="${colour(p)}" ${p.theme >= 0 ? "" : 'class="loose"'}/>`).join("");
    document.getElementById("legend").innerHTML = TH.groups.map((g) => `<span><b class="dot" style="background:${g.colour}"></b>${esc(g.name)}</span>`).join("") + `<span><b class="dot" style="background:#5d6f68"></b>No theme</span>`;
    document.getElementById("groups").innerHTML = TH.groups.map((g) => {
      const ts = TH.themes.filter((t) => t.group === g.id);
      return `<section class="tgroup"><h2><b class="dot" style="background:${g.colour}"></b>${esc(g.name)}</h2>${g.note ? `<p class="small">${esc(g.note)}</p>` : ""}
        <ul class="cards themes">${ts.map((t) => `<li class="card" data-card="${t.id}"><h3><a href="#/theme/${t.id}">${esc(t.name)}</a></h3>
          <p class="sum">${esc(t.summary)}</p>
          <p class="small">${plural(t.size, "passage")} · ${plural(t.interviews, "interview")}</p></li>`).join("")}</ul></section>`;
    }).join("");
    const focus = (id) => {
      svg.classList.toggle("dim", id !== null);
      svg.querySelectorAll("circle").forEach((c) => c.classList.toggle("lit", id !== null && +c.dataset.theme === id));
      document.getElementById("mapname").textContent = id === null ? "Every dot is a passage; near dots talk about similar things" : themeById.get(id).name;
    };
    svg.addEventListener("mouseover", (ev) => {
      const c = ev.target.closest("circle");
      if (!c) return;
      const p = P[+c.dataset.pt], b = B[p.first];
      const long = B.slice(p.first, p.first + p.count).reduce((a, x) => (x.text.length > a.text.length ? x : a));
      focus(p.theme >= 0 ? p.theme : null);
      showTip(c, `<b>${esc(D[b.doc].name)}</b><span>${p.theme >= 0 ? esc(themeById.get(p.theme).name) : "No theme"}</span><span class="q">${esc(long.text.slice(0, 150))}…</span>`);
    });
    svg.addEventListener("mouseout", () => focus(null));
    svg.addEventListener("click", (ev) => {
      const c = ev.target.closest("circle");
      if (!c) return;
      const p = P[+c.dataset.pt];
      location.hash = p.theme >= 0 ? `#/theme/${p.theme}` : readHref(B[p.first]).slice(0);
    });
    document.getElementById("groups").addEventListener("mouseover", (ev) => {
      const c = ev.target.closest("[data-card]");
      focus(c ? +c.dataset.card : null);
    });
    window.scrollTo(0, 0);
    return { name: "themes" };
  }

  function themeView(r0) {
    setNav("themes");
    const t = themeById.get(+r0.seg[1]);
    if (!t) {
      app.innerHTML = `<p class="empty">There is no such theme. <a href="#/themes">See the themes</a>.</p>`;
      return { name: "theme" };
    }
    document.title = `${t.name} · Linking Lost Jazz Shrines`;
    const g = groupOf(t);
    const ps = t.passages.map((i) => P[i]);
    const perDoc = new Map();
    for (const p of ps) perDoc.set(B[p.first].doc, (perDoc.get(B[p.first].doc) || 0) + 1);
    const passageHtml = (p) => {
      const bs = B.slice(p.first, p.first + p.count);
      const d = D[bs[0].doc];
      const long = bs.reduce((a, x) => (x.text.length > a.text.length ? x : a));
      const body = bs.map((b) => `<p class="${role(b)}"><span class="spk">${esc(speaker(b))}</span> ${esc(b.text)}</p>`).join("");
      const size = bs.reduce((a, b) => a + b.text.length, 0);
      return `<li class="passage${size > 900 ? " clamp" : ""}">
        <p class="where"><a href="${readHref(long)}"><b>${esc(d.name)}</b> <span>${p.count > 1 ? `blocks ${esc(bs[0].n)} to ${esc(bs[bs.length - 1].n)}` : `block ${esc(bs[0].n)}`}</span></a>${p.core ? "" : `<span class="near">near this theme</span>`}</p>
        <div class="ptext">${body}</div>
        <p class="chips">${size > 900 ? `<button class="plain" data-open>Show all of it</button>` : ""}<a class="go" href="${readHref(long)}">Read in context ${ic("right")}</a></p></li>`;
    };
    app.innerHTML = `<article class="themepage">
      <p class="crumb"><a href="#/themes">${ic("left")} Themes</a><span><b class="dot" style="background:${g.colour}"></b>${esc(g.name)}</span></p>
      <header class="page-head"><h1>${esc(t.name)}</h1><p class="lede">${esc(t.summary)}</p></header>
      <div class="theme-cols">
        <aside class="rail">
          <section class="facet"><h2>Threads</h2><ul class="threads">${t.threads.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
          <section class="facet"><h2>Most tagged here</h2><p class="chips">${t.entities.map(([e, n]) => chip(E[e], ` <b>${n}</b>`)).join("")}</p></section>
          <section class="facet"><h2>Interviews</h2><ul class="doclist static">${[...perDoc].sort((a, b) => b[1] - a[1]).map(([di, n]) => `<li><a href="#/read/${D[di].id}/${encodeURIComponent(B[D[di].first].n)}"><span>${esc(D[di].name)}</span><b>${n}</b></a></li>`).join("")}</ul></section>
          ${t.kind !== "story" ? `<p class="small note">${t.kind === "meta" ? "These passages share the mechanics of an interview more than a subject." : "The readers found more than one subject in this group; the threads list them."}</p>` : ""}
        </aside>
        <section><p class="small">${plural(ps.length, "passage")} from ${plural(perDoc.size, "interview")}, the most typical first.</p>
          <ol class="passages">${ps.map(passageHtml).join("")}</ol></section>
      </div></article>`;
    app.querySelector(".passages").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-open]");
      if (b) b.closest(".passage").classList.remove("clamp"), b.remove();
    });
    window.scrollTo(0, 0);
    return { name: "theme" };
  }

  // ------------------------------------------------------------------ about
  function aboutView() {
    setNav("about");
    document.title = "About · Linking Lost Jazz Shrines";
    const tags = B.reduce((a, b) => a + b.ents.length, 0);
    app.innerHTML = `<article class="prose">
      <header class="page-head"><h1>About this site</h1></header>
      <p>Linking Lost Jazz Shrines is a Linked Jazz project built on the oral histories that the Weeksville Heritage Center
      recorded about the lost jazz shrines of Brooklyn. This site is a way to search and read those interviews.</p>
      <h2>The data</h2>
      <p>The site holds a snapshot, taken on ${niceDate(C.built)}, of the project's records on the
      <a href="https://base.semlab.io/wiki/Item:Q18807" target="_blank" rel="noreferrer">Semantic Lab Wikibase</a>:
      ${D.length} interviews, ${num(B.length)} text blocks and ${num(tags)} tags that connect a block to one of ${num(E.filter((e) => e.n).length)}
      people, jazz shrines, groups and organizations. A block is one turn of the conversation, sometimes several. The tags were made by the
      project team while preparing the transcripts. Every block links back to its own item on the Wikibase.</p>
      <h2>Search</h2>
      <p>The whole text is loaded into the page, so searching happens in your browser and nothing you type is sent anywhere. All the words of a
      query must be in a block. Put a phrase in quotation marks to find it exactly, and end a word with an asterisk to match its beginning
      (<code>organ*</code>). Plurals are matched with their singular. The transcripts spell some names as they were heard, so try a variant if a name is missing,
      or use the people and places filter, which follows the team's tags instead of the spelling.</p>
      <h2>Reading</h2>
      <p>Any block can be opened in its interview. The reader starts at that block, shows what was said just before and after, and brings in more as you
      read on. Names the team tagged are underlined; they lead to every other block that mentions the same person or place.</p>
      ${TH ? `<h2>Themes</h2>
      <p>The themes were made by machine and should be read as a finding aid. The transcripts were joined into ${num(P.length)} passages so that a
      question stays with its answer. Each passage was turned into a vector with Google's ${esc(TH.model)} embedding model, the vectors were clustered
      (after removing what the passages of one interview have in common, so that a theme gathers several interviews), and each cluster was read in
      full by Anthropic's Claude Opus, which named it, summarised it and set aside passages that did not fit. ${num(P.filter((p) => p.theme < 0).length)} passages
      belong to no theme. The summaries are a model's description of what speakers say, and can be wrong; the passages under each theme are the source.</p>` : ""}
      <h2>The interviews</h2>
      <p>The recordings and transcripts belong to the Weeksville Heritage Center. Interviews were conducted by Willard Jenkins, Maxine Gordon,
      Jennifer Scott and others between 2008 and 2010.</p>
    </article>`;
    window.scrollTo(0, 0);
    return { name: "about" };
  }

  const built = document.getElementById("foot-built");
  if (built) built.textContent = `Data snapshot of ${niceDate(C.built)}`;
  render();
})();
