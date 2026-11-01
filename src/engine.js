/* ---------- graph engine (canvas, 2D + 3D) ---------- */
const FOCAL = 1565, DIST = 2000;
// 3D zoom is a dolly: the camera sits at DIST / k from the centre (it moves back to zoom out instead of changing lens),
// so a wide view never stretches the nodes nearest the camera. Scale for a point at depth z2: FOCAL·k / (DIST + z2·k)
const NEAR = 140;   // nodes closer to the camera than this fade out as you fly past them
const pScale = (z2, k) => (FOCAL * k) / Math.max(NEAR * 0.5, DIST + z2 * k);
const focusZ = () => -DIST * 0.22 / Math.max(1, G.cam.k);
const GROUP_ORDER = ["AI", "VFX", "3D", "Tech", "General", "Projects", "Claude", "Horizon", "Calendar"];
const GROUP_COL = { AI: "#b38cff", VFX: "#ff7a59", "3D": "#ffc04d", Tech: "#5cf2c2", General: "#9fb0c8", Projects: "#ff5c8a", Horizon: "#38bdf8", Calendar: "#fde68a", Claude: "#e8956b" };
const BIG_GROUPS = new Set(["Projects", "Horizon", "Claude"]);
// branches between the core and the main topics: saved inspiration (Instagram etc.) sits under its own branch,
// apart from the actual work (Projects), research (Horizon Scans) and the Team Calendar
const REALM_ID = "realm:insp", REALM_GROUPS = ["AI", "VFX", "3D", "Tech", "General"], REALM_COL = "#d8b4fe";
const REALM_SET = new Set(REALM_GROUPS);
const CORE_COL = "#cdf6ff", LENS_COL = "#38e1ff";
const WAVE_STEP = 180, WAVE_EVERY = 4000;
const G = {
  cv: null, ctx: null, wrap: null, W: 0, H: 0, dpr: 1,
  nodes: [], byId: new Map(), links: [], tree: [], anchors: new Map(), adj: new Map(),
  posts: [], postById: new Map(),
  dim: store.get("dim", 3) === 2 ? 2 : 3,
  layout: ["cluster", "proximity", "mixed"].includes(store.get("layout", "cluster")) ? store.get("layout", "cluster") : "cluster",
  spin: store.get("spin", true), labelLvl: clamp(+store.get("labLvl", store.get("labels", false) ? 4 : 2) || 0, 0, 4), labelAuto: store.get("labAuto", !store.get("labels", false)), userHidden: new Set(store.get("hiddenNodes", [])), pinOffer: null, showRel: store.get("showRel", true), labA: new Map(), labT: {}, labAnim: false, autoLvl: 2, showAI: store.get("showAI", true), showPosts: store.get("posts", true), showThumbs: store.get("thumbs", true), netLevel: clamp(store.get("netLevel", 1), 1, 3), arrange: ["free", "pillars", "grid", "explode"].includes(store.get("arrange", "free")) ? store.get("arrange", "free") : "free", pullDepth: 2, freePos: null,
  cam: { k: 1, tx: 0, ty: 0, yaw: 0.55, pitch: -0.32, roll: 0 }, camAnim: null, rot: null,
  alpha: 0, hover: null, selected: null, focus: null, lit: null, litPosts: null, waveT0: 0,
  pulled: null, anims: [], pulses: [], raf: 0, drag: null, pointers: new Map(), pinch: null,
  colors: [], sig: "", fitAfter: 0, postsCache: new Map(), sprites: new Map(),
  thumbs: null, sheetImgs: [], relate: null, hoverTimer: 0, mouse: { x: 0, y: 0 }, floorY: 0,
};
const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const HEXC = new Map();
function hexRGB(hex) {
  const k = String(hex); let c = HEXC.get(k);
  if (c) return c;
  const m = /^#?([0-9a-f]{6})$/i.exec(k.trim());
  if (m) { const v = parseInt(m[1], 16); c = [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  else { const r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(k); c = r ? [+r[1], +r[2], +r[3]] : [125, 144, 168]; }
  if (HEXC.size > 4000) HEXC.clear();
  HEXC.set(k, c); return c;
}
function rgba(hex, a) { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; }
function mix(hex, hex2, t) { const a = hexRGB(hex), b = hexRGB(hex2), c = a.map((v, i) => Math.round(v + (b[i] - v) * t)); return "#" + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1); }
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  G.colors = Array.from({ length: NCOL }, (_, i) => cs.getPropertyValue("--c" + i).trim() || "#7d90a8");
}
function colorHex(catId) { const c = catById(catId); return c ? G.colors[(c.color || 0) % NCOL] : "#7d90a8"; }
const metaLabel = (id) => (st.meta && st.meta.labels && st.meta.labels[id]) || {};
const GROUP_NAME = { Horizon: "Horizon Scans", Calendar: "Team Calendar", Claude: "Built with Claude" };
const groupLabel = (g) => metaLabel("grp:" + g).name || GROUP_NAME[g] || g;
const grpOfCk = (ck) => (ck === "_none" ? "General" : groupOf(catById(ck)));
const codeOf = (u) => { const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|tv)\/([^/?#]+)/.exec(String(u || "")); return m ? m[1] : ""; };
/* ---------- dates for the timeline ---------- */
const DAY = 86400000, WEEK = 7 * DAY;
// a calendar day (YYYY-MM-DD) at local midnight
function dayMs(d) { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(d || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; }
// Instagram shortcodes encode the media id, whose top bits are milliseconds since Instagram's epoch
const IG_ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function igDate(code) {
  if (!code || code.length < 10 || typeof BigInt !== "function") return null;
  let n = 0n;
  for (const ch of code.slice(0, 11)) { const v = IG_ABC.indexOf(ch); if (v < 0) return null; n = n * 64n + BigInt(v); }
  const t = Number(n >> 23n) + 1314220021721;
  return t > 1.3e12 && t < Date.now() + DAY ? t : null;
}
function parsePosts(body) {
  const key = String(body || "");
  if (G.postsCache.has(key)) return G.postsCache.get(key);
  const out = [];
  const lines = key.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const next = (lines[i + 1] || "").trim();
    if (/^[-*•]\s/.test(t) && /^https?:\/\/\S+$/.test(next)) {
      let txt = t.replace(/^[-*•]\s+/, "");
      const dm = txt.match(/^\[(\d{4}-\d\d-\d\d)\]\s*/);
      if (dm) txt = txt.slice(dm[0].length);
      const m = txt.match(/^@(\S+?):\s(.*)$/);
      const code = codeOf(next);
      // optional tag line under the link: "Tags: Format · Source · Tool, Tool · what it's about"
      const tm = (lines[i + 2] || "").match(/^\s*Tags:\s*(.+)$/);
      const tags = tm ? parseTags(tm[1]) : null;
      out.push({ handle: m ? m[1] : "", desc: m ? m[2] : txt, url: next, code, date: dm ? dayMs(dm[1]) : igDate(code), tags });
      i += tm ? 2 : 1;
    } else {
      for (const u of t.matchAll(/https?:\/\/[^\s)]+/g)) { const code = codeOf(u[0]); out.push({ handle: "", desc: t.replace(u[0], "").replace(/^[-*•]\s+/, "").trim() || u[0], url: u[0], code, date: igDate(code) }); }
    }
  }
  G.postsCache.set(key, out);
  return out;
}
function parseTags(t) {
  const [f, src, tools, about] = String(t).split(" · ").map((x) => (x || "").trim());
  return { f: f || "", s: src || "", t: (tools || "").split(",").map((x) => x.trim()).filter((x) => x && x !== "—"), a: about || "" };
}
const tagText = (g) => (g ? [g.f, g.s, ...g.t, g.a].filter(Boolean).join(" ") : "");
// chips for a post's tags: what kind of video it is, who made it, the tools in it, and what it's about
function tagChips(g, small) {
  if (!g) return null;
  return h("div", { class: "tags" + (small ? " sm" : "") },
    g.f ? h("span", { class: "tag f" }, g.f) : null, g.s ? h("span", { class: "tag s" }, g.s) : null,
    g.t.map((x) => h("span", { class: "tag t" }, x)), !small && g.a ? h("span", { class: "tag a" }, g.a) : null);
}
// a topic's posts at a glance: how many tutorials, breakdowns …, and the tools that come up most
function tagSummary(posts) {
  const F = new Map(), T = new Map();
  for (const p of posts) { const g = p.tags; if (!g) continue; if (g.f) F.set(g.f, (F.get(g.f) || 0) + 1); for (const x of g.t) T.set(x, (T.get(x) || 0) + 1); }
  if (!F.size) return null;
  const pl = (k, n) => n + " " + (n > 1 ? ({ "Case study": "case studies", Tips: "tips", News: "news", "Tool launch": "tool launches" }[k] || k.toLowerCase() + "s") : ({ Tips: "tips", News: "news" }[k] || k.toLowerCase()));
  const fs = [...F.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => pl(k, n)).join(" · ");
  const ts = [...T.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  return h("div", { class: "tag-sum" }, h("p", { class: "meta" }, fs), ts.length ? h("div", { class: "tags sm" }, ts.map((x) => h("span", { class: "tag t" }, x))) : null);
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "link"; } };
const srcLabel = (u) => (/instagram\.com/.test(u) ? "Instagram" : hostOf(u));

/* ---------- thumbnails (sprite sheets published next to the page) ---------- */
function loadThumbs() {
  // the offline camera copy carries its thumbnails inline
  if (window.__THUMBS) { const j = window.__THUMBS; G.thumbs = j; G.sheetImgs = j.sheets.map((src) => { const im = new Image(); im.src = src; im.onload = kick; return im; }); return; }
  fetch("thumbs/thumbs.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j || !j.m) return;
    G.thumbs = j;
    G.sheetImgs = j.sheets.map((src) => { const im = new Image(); im.decoding = "async"; im.src = src; im.onload = kick; return im; });
    kick();
  }).catch(() => {});
}
function thumbOf(code) {
  const T = G.thumbs; if (!T || !code || !G.showThumbs) return null;
  const v = T.m[code]; if (v == null) return null;
  const sh = Math.floor(v / 1000), k = v % 1000;
  return { sh, col: k % T.n, row: Math.floor(k / T.n) };
}
function thumbEl(code, size, cls, extra) {
  const th = thumbOf(code); if (!th) return null;
  const T = G.thumbs, full = T.n * size;
  return h("span", { class: cls || "th", style: `width:${size}px;height:${size}px;background-image:url(${T.sheets[th.sh]});background-size:${full}px ${full}px;background-position:-${th.col * size}px -${th.row * size}px`, ...(extra || {}) });
}

/* ---------- 3D sphere sprites (lit from top-left, cyan rim light, specular) ---------- */
function ballSprite(col) {
  let s = G.sprites.get("b" + col);
  if (s) return s;
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), R = S / 2 - 2, cx = S / 2, cy = S / 2;
  let gr = g.createRadialGradient(cx - R * 0.36, cy - R * 0.42, R * 0.04, cx + R * 0.05, cy + R * 0.08, R * 1.02);
  gr.addColorStop(0, mix(col, "#ffffff", 0.62));
  gr.addColorStop(0.28, mix(col, "#ffffff", 0.12));
  gr.addColorStop(0.62, mix(col, "#000000", 0.38));
  gr.addColorStop(0.9, mix(col, "#000000", 0.78));
  gr.addColorStop(1, mix(col, "#000000", 0.88));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "source-atop";
  gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.36, R * 0.92, cx - R * 0.3, cy - R * 0.36, R * 1.42);
  gr.addColorStop(0, "rgba(56,225,255,0)"); gr.addColorStop(0.55, "rgba(120,235,255,.42)"); gr.addColorStop(1, "rgba(160,245,255,.85)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "source-over";
  gr = g.createRadialGradient(cx - R * 0.42, cy - R * 0.48, 0, cx - R * 0.42, cy - R * 0.48, R * 0.34);
  gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(0.4, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.beginPath(); g.ellipse(cx - R * 0.42, cy - R * 0.48, R * 0.34, R * 0.26, -0.6, 0, Math.PI * 2); g.fill();
  G.sprites.set("b" + col, c);
  return c;
}
// small pre-scaled copy for tiny dots (downscaling the 128px sphere per post is slow)
function ballSmall(col) {
  let s = G.sprites.get("bs" + col);
  if (s) return s;
  const c = document.createElement("canvas"); c.width = c.height = 16;
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(ballSprite(col), 0, 0, 16, 16);
  G.sprites.set("bs" + col, c);
  return c;
}
function glowSprite(col) {
  let s = G.sprites.get("g" + col);
  if (s) return s;
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, rgba(col, 0.55)); gr.addColorStop(0.35, rgba(col, 0.18)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  G.sprites.set("g" + col, c);
  return c;
}
function shadowSprite() {
  let s = G.sprites.get("shadow");
  if (s) return s;
  const S = 96, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(0.5, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  G.sprites.set("shadow", c);
  return c;
}

// display radius per hierarchy level (physics keeps n.r): core > group > category > hub > note
function dR(n) {
  switch (n.kind) {
    case "core": return G.dim === 3 ? 46 : 34;
    case "group": return BIG_GROUPS.has(n.grp) ? 31 : 24;
    case "realm": return 32;
    case "cat": return 12;
    case "lens": return 14;
    case "post": return n.r;
    default: return n.hub ? n.r * 0.55 : n.r * 0.62;
  }
}
const DRAW_RANK = { post: 0, note: 1, cat: 3, lens: 4, group: 5, realm: 5.5, core: 6 };
function haloSprite() {
  let s = G.sprites.get("halo");
  if (s) return s;
  const S = 32, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(56,225,255,.55)"); gr.addColorStop(0.45, "rgba(56,225,255,.18)"); gr.addColorStop(1, "rgba(56,225,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  G.sprites.set("halo", c);
  return c;
}

/* ---------- layout anchors: core -> groups -> categories ---------- */
function relaxCircles(list, iters) {
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz) || 1, min = a.r + b.r;
      if (d < min) { const push = (min - d) / 2, ux = dx / d, uy = dy / d, uz = dz / d; if (!a.fixed) { a.x -= ux * push; a.y -= uy * push; a.z -= uz * push; } if (!b.fixed) { b.x += ux * push; b.y += uy * push; b.z += uz * push; } }
    }
  }
}
function computeAnchors() {
  const m = new Map();
  const catW = new Map();
  for (const n of G.nodes) if (n.kind === "note") catW.set(n.ck, (catW.get(n.ck) || 0) + (n.rr + 16) ** 2);
  const groups = new Map();
  for (const ck of catW.keys()) { const g = grpOfCk(ck); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(ck); }
  const D3 = G.dim === 3;
  const Rc = (ck) => 34 + Math.sqrt(catW.get(ck)) * 1.08;
  const Rg = (g) => { const cs = groups.get(g); return cs.length === 1 ? Rc(cs[0]) + 30 : Math.sqrt(cs.reduce((s, c) => s + Rc(c) ** 2, 0)) * 1.32 + 30; };
  const keys = GROUP_ORDER.filter((g) => groups.has(g));
  // inspiration (left half) and the actual work and research (right half) sit on opposite sides of the core
  const dir2 = { General: [-0.12, -1], VFX: [-0.68, -0.74], AI: [-1, -0.08], Tech: [-0.8, 0.6], "3D": [-0.3, 0.96], Horizon: [0.82, -0.58], Projects: [0.96, 0.3], Calendar: [0.42, 0.92], Claude: [0.72, 0.7] };
  // 3D: groups sit on a full sphere around the core (up, down, front, back), not a flattened disc
  const dir3 = { AI: [-0.95, -0.1, 0.35], VFX: [-0.55, -0.75, -0.4], "3D": [-0.35, 0.75, 0.6], Tech: [-0.7, 0.45, -0.65], General: [-0.1, -0.95, 0.35], Projects: [0.9, 0.3, 0.35], Horizon: [0.7, -0.55, -0.5], Calendar: [0.45, 0.65, -0.65], Claude: [0.8, 0.1, -0.6] };
  // the Inspirations branch is its own hub out to one side of the core; its groups fan out around it, away from the
  // core, so saved inspiration reads as one cluster, apart from the projects and research on the other side
  const rKeys = keys.filter((g) => REALM_SET.has(g));
  const RD = D3 ? [-0.9, -0.38, 0.25] : [-0.88, -0.48, 0], RL = Math.hypot(...RD);   // up and to the left, so its label clears the core's
  const ru = RD.map((v) => v / RL);
  const rR = rKeys.length ? Math.max(...rKeys.map(Rg)) : 0;
  const rd = 190 + rR * 0.35;   // close to the core: the branch is part of Capability Development, not a separate island
  const RC = { x: ru[0] * rd * (D3 ? 1.3 : 1), y: ru[1] * rd, z: ru[2] * rd * (D3 ? 1.3 : 1) };
  let gs;
  if (D3) {
    // 3D: every group gets its own evenly spaced direction on a sphere around the core (Inspirations' groups share one
    // side, the work the other), then the whole arrangement is balanced so Capability Development sits at the true centre
    const N = keys.length, fib = [];
    for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), ph = i * 2.399963 + 0.4; fib.push([Math.cos(ph) * r, y * 0.9, Math.sin(ph) * r]); }
    const byR = fib.slice().sort((a, b) => (b[0] * ru[0] + b[1] * ru[1] + b[2] * ru[2]) - (a[0] * ru[0] + a[1] * ru[1] + a[2] * ru[2]));
    const order = [...rKeys, ...keys.filter((g) => !REALM_SET.has(g))];
    gs = order.map((g, i) => { const R = Rg(g), d = byR[i], L = Math.hypot(...d) || 1, dd = (170 + R) * 1.5; return { g, r: R + 40, x: (d[0] / L) * dd, y: (d[1] / L) * dd, z: (d[2] / L) * dd, w: R * R }; });
    gs.push({ g: "_core", r: 110, x: 0, y: 0, z: 0, fixed: true });
    for (let it = 0; it < 6; it++) {
      relaxCircles(gs, 30);
      let W = 0, cx = 0, cy = 0, cz = 0; for (const a of gs) if (!a.fixed) { W += a.w; cx += a.x * a.w; cy += a.y * a.w; cz += a.z * a.w; }
      cx /= W; cy /= W; cz /= W;
      for (const a of gs) if (!a.fixed) { a.x -= cx; a.y -= cy; a.z -= cz; }
    }
    relaxCircles(gs, 40);
    for (const a of gs) if (a.g !== "_core") m.set("grp:" + a.g, { x: a.x, y: a.y, z: a.z, r: a.r });
    // the Inspirations hub sits between the core and its groups
    const ra = gs.filter((a) => REALM_SET.has(a.g));
    if (ra.length) { let x = 0, y = 0, z = 0; for (const a of ra) { x += a.x; y += a.y; z += a.z; } const L = Math.hypot(x, y, z) || 1, near = Math.min(...ra.map((a) => Math.hypot(a.x, a.y, a.z))) * 0.62; m.set(REALM_ID, { x: x / L * near, y: y / L * near, z: z / L * near, r: 70 }); }
  } else {
  gs = keys.map((g) => {
    const R = Rg(g);
    if (REALM_SET.has(g)) {
      const d = D3 ? dir3[g] : [...dir2[g], 0], L = Math.hypot(...d);
      // lean each group's direction away from the core, then place it around the branch hub
      const v = [d[0] / L + ru[0] * 0.55, d[1] / L + ru[1] * 0.55, (D3 ? d[2] / L + ru[2] * 0.55 : 0)], vl = Math.hypot(...v) || 1, dd = (D3 ? 1.35 : 1) * (70 + R);
      return { g, r: R + 40, x: RC.x + (v[0] / vl) * dd, y: RC.y + (v[1] / vl) * dd, z: RC.z + (v[2] / vl) * dd };
    }
    const d = D3 ? dir3[g] : [...dir2[g], 0], L = Math.hypot(...d), dd = D3 ? (150 + R) * 1.45 : 90 + R;
    return { g, r: R + 40, x: (d[0] / L) * dd, y: (d[1] / L) * dd, z: (d[2] / L) * dd };
  });
  gs.push({ g: "_core", r: 95, x: 0, y: 0, z: 0, fixed: true });
  if (rKeys.length) gs.push({ g: "_realm", r: 70, ...RC, fixed: true });
  relaxCircles(gs, 80);
  for (const a of gs) if (a.g !== "_core" && a.g !== "_realm") m.set("grp:" + a.g, { x: a.x, y: a.y, z: a.z, r: a.r });
  if (rKeys.length) m.set(REALM_ID, { ...RC, r: 90 });
  }
  for (const a of gs) {
    if (a.g === "_core" || a.g === "_realm") continue;
    const cs = groups.get(a.g).sort((x, y) => catW.get(y) - catW.get(x));
    const hub = !D3 && REALM_SET.has(a.g) && rKeys.length ? RC : { x: 0, y: 0, z: 0 };
    const ox = a.x - hub.x, oy = a.y - hub.y, oz = a.z - hub.z, out = Math.hypot(ox, oy, oz) || 1;
    const ux = ox / out, uy = oy / out, uz = oz / out;
    const list = cs.map((ck, i) => {
      if (cs.length === 1) return { ck, r: Rc(ck), x: a.x + ux * 40, y: a.y + uy * 40, z: a.z + uz * 40 };
      const ring = (Math.max(0, a.r - 40 - Rc(ck)) * 0.85 + 30) * (D3 ? 1.6 : 1);
      if (D3) {
        const K = cs.length, yy = 1 - (2 * (i + 0.5)) / K, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), phi = i * 2.399963;
        // spread categories over the outward-facing half of a sphere around the group
        let cx = Math.cos(phi) * rr, cy = yy, cz = Math.sin(phi) * rr;
        const dot = cx * ux + cy * uy + cz * uz;
        if (dot < -0.2) { cx -= 1.4 * dot * ux; cy -= 1.4 * dot * uy; cz -= 1.4 * dot * uz; }
        const cl = Math.hypot(cx, cy, cz) || 1;
        return { ck, r: Rc(ck), x: a.x + (cx / cl) * ring, y: a.y + (cy / cl) * ring, z: a.z + (cz / cl) * ring };
      }
      const ang = Math.atan2(uy, ux) + (i / cs.length) * Math.PI * 2;
      return { ck, r: Rc(ck), x: a.x + Math.cos(ang) * ring, y: a.y + Math.sin(ang) * ring, z: 0 };
    });
    relaxCircles(list, 60);
    for (const c of list) m.set("cat:" + c.ck, { x: c.x, y: c.y, z: c.z, r: c.r });
  }
  return m;
}

/* ---------- data in ---------- */
function cloudR(n, count) {
  if (!count) return n.r;
  return G.dim === 3 ? n.r + 9 + 5.4 * Math.sqrt(count) : n.r + 8 + 7 * Math.sqrt(count);
}
function postOffsets(n, count) {
  const out = [];
  if (G.dim === 3) {
    const R = cloudR(n, count) - 2;
    for (let i = 0; i < count; i++) {
      const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = i * 2.399963 + n.seed;
      const jitter = 0.86 + 0.14 * ((i * 7919) % 13) / 13;
      out.push({ x: Math.cos(phi) * r * R * jitter, y: y * R * jitter, z: Math.sin(phi) * r * R * jitter });
    }
  } else {
    for (let i = 0; i < count; i++) {
      const rad = n.r + 8 + 7 * Math.sqrt(i + 0.6), a = i * 2.399963 + n.seed;
      out.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, z: 0 });
    }
  }
  return out;
}
function graphSetData(list, links) {
  G.dataV = (G.dataV || 0) + 1;
  const old = G.byId, oldPosts = G.postById;
  const ids = new Set(list.map((n) => n.id));
  const sim = [], byId = new Map();
  const ensure = (o) => {
    let n = old.get(o.id);
    if (!n) n = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fresh: true, seed: Math.random() * 6.283 };
    Object.assign(n, o);
    sim.push(n); byId.set(n.id, n);
    return n;
  };
  const cks = [...new Set(list.map((n) => n.ck))];
  // a category you just added still appears while it is empty, so it can be filled from the map
  const keep = new Set(store.get("newCats", []));
  for (const c of cats()) if (keep.has(c.id) && !cks.includes(c.id)) cks.push(c.id);
  const grps = new Set(cks.map(grpOfCk));
  const core = ensure({ id: "core", kind: "core", title: metaLabel("core").name || "Capability Development", full: metaLabel("core").title || "", color: CORE_COL, r: 30, hub: true, tp: null, depth: 0 });
  core.pin = true; core.x = core.y = core.z = 0;
  const hasRealm = REALM_GROUPS.some((g) => grps.has(g));
  if (hasRealm) ensure({ id: REALM_ID, kind: "realm", realm: REALM_GROUPS, title: metaLabel(REALM_ID).name || "Inspirations", full: metaLabel(REALM_ID).title || "Saved inspiration from Instagram and other sources", color: REALM_COL, r: 28, hub: true, tp: "core", depth: 1 });
  const gDepth = (g) => (hasRealm && REALM_SET.has(g) ? 2 : 1);
  for (const g of GROUP_ORDER) if (grps.has(g)) ensure({ id: "grp:" + g, kind: "group", grp: g, title: groupLabel(g), full: metaLabel("grp:" + g).title || "", color: GROUP_COL[g], r: BIG_GROUPS.has(g) ? 27 : 21, hub: true, tp: hasRealm && REALM_SET.has(g) ? REALM_ID : "core", depth: gDepth(g) });
  for (const ck of cks) ensure({ id: "cat:" + ck, kind: "cat", ck, grp: grpOfCk(ck), title: ck === "_none" ? "Unsorted" : catName(ck), full: (catById(ck) || {}).title || "", color: ck === "_none" ? "#7d90a8" : colorHex(ck), r: 13, hub: true, tp: "grp:" + grpOfCk(ck), depth: gDepth(grpOfCk(ck)) + 1 });
  for (const n of list) ensure({ ...n, kind: "note", grp: grpOfCk(n.ck), tp: n.parent && ids.has(n.parent) ? n.parent : "cat:" + n.ck });
  for (const n of sim) if (n.kind === "note") { let d = gDepth(n.grp) + 2, p = byId.get(n.tp); while (p && p.kind === "note" && d < 10) { d++; p = byId.get(p.tp); } n.depth = d; }
  for (const n of sim) n.rr = n.kind === "note" ? cloudR(n, (n.posts || []).length) : n.r;
  if (G.relate && G.relate.lens) {
    const L = ensure({ id: "lens", kind: "lens", title: "✦ " + G.relate.q, color: LENS_COL, r: 15, hub: true, tp: null, depth: 0 });
    L.pin = true;
  }
  G.nodes = sim; G.byId = byId;
  G.anchors = computeAnchors();
  for (const n of sim) {
    if (!n.fresh) continue;
    n.fresh = false;
    const par = byId.get(n.tp);
    const a = G.anchors.get(n.id) || (par && !par.fresh ? par : null) || G.anchors.get("cat:" + n.ck) || G.anchors.get("grp:" + n.grp) || { x: 0, y: 0, z: 0 };
    n.x = a.x + (Math.random() - 0.5) * 60; n.y = a.y + (Math.random() - 0.5) * 60; n.z = G.dim === 3 ? a.z + (Math.random() - 0.5) * 60 : 0;
  }
  // posts orbiting their note
  const posts = [], postById = new Map();
  if (G.showPosts) {
    for (const n of sim) {
      if (n.kind !== "note" || !n.posts || !n.posts.length) continue;
      const offs = postOffsets(n, n.posts.length);
      n.posts.forEach((pp, i) => {
        const id = `p:${n.id}:${i}`;
        let p = oldPosts.get(id);
        if (!p || p.code !== pp.code) p = { id, kind: "post", sat: true, free: false, x: n.x, y: n.y, z: n.z };
        Object.assign(p, { idx: i, parentId: n.id, post: pp, handle: pp.handle, name: (n.pnames || {})[pp.code] || "", title: pp.desc, tags: pp.tags || null, url: pp.url, code: pp.code, color: n.color, r: 3.3, ox: offs[i].x, oy: offs[i].y, oz: offs[i].z, depth: n.depth + 1 });
        posts.push(p); postById.set(id, p);
      });
    }
  }
  G.posts = posts; G.postById = postById;
  G.tree = sim.filter((n) => n.tp && byId.has(n.tp)).map((n) => ({ s: byId.get(n.tp), t: n }));
  G.links = links.filter((l) => l.kind !== "part").map((l) => ({ s: byId.get(l.a), t: byId.get(l.b), type: l.type, w: l.s || 1, key: pairKey(l.a, l.b) })).filter((l) => l.s && l.t);
  for (const l of G.links) l.cross = l.s.ck !== l.t.ck;
  if (G.relate && G.relate.lens && byId.has("lens")) {
    const top = G.relate.top.filter((id) => byId.has(id)).slice(0, 14);
    for (const id of top) G.links.push({ s: byId.get("lens"), t: byId.get(id), type: "lens", w: 1, key: "lens|" + id });
    placeLens();
  }
  G.adj = new Map();
  const addAdj = (a, b) => { if (!G.adj.has(a)) G.adj.set(a, new Set()); if (!G.adj.has(b)) G.adj.set(b, new Set()); G.adj.get(a).add(b); G.adj.get(b).add(a); };
  for (const l of G.links) if (l.type !== "lens") addAdj(l.s.id, l.t.id);
  G.aiPairs = new Set(G.links.filter((l) => l.type === "ai").map((l) => l.key));
  G.netCache = null;
  for (const l of G.tree) addAdj(l.s.id, l.t.id);
  if (G.pulled && !byId.has(G.pulled.root)) releasePull(true);
  if (G.arrange !== "free") applyArrange(false);
  const sig = G.dim + "|" + sim.map((n) => n.id).join(",") + "#" + G.links.map((l) => l.key).join(",");
  if (sig !== G.sig) {
    const first = !G.sig;
    const big = first || Math.abs(G.sig.length - sig.length) > 300 || G.sig.split("|")[0] !== String(G.dim) || (byId.has(REALM_ID) && !old.has(REALM_ID));
    G.sig = sig;
    if (big) { settle(first ? 420 : 300); fitCamera(true); }
    else G.alpha = Math.max(G.alpha, 0.3);
  }
  applyPins();
  syncPosts();
  tlDates(); tlApply();
  updateStatus();
  kick();
}
function placeLens() {
  const L = G.byId.get("lens"); if (!L || !G.relate || L.userPlaced || (G.pulled && G.pulled.root === "lens")) return;
  // the search sits above everything, roughly over the topics it matched, with links down to them
  const top = G.relate.top.map((id) => G.byId.get(id)).filter(Boolean).slice(0, 14);
  const at = (n) => (G.arrT && G.arrT.get(n.id)) || n;
  let minY = Infinity, x = 0;
  for (const n of G.nodes) if (n !== L) minY = Math.min(minY, at(n).y - (n.rr || n.r));
  for (const n of top) x += at(n).x;
  L.x = top.length ? (x / top.length) * 0.5 : 0;
  L.y = (isFinite(minY) ? minY : 0) - 170;
  L.z = 0;
}

/* ---------- physics ---------- */
const CHARGE = { core: 9000, realm: 7000, group: 6200, cat: 3000, note: 1500, lens: 800 };
function tick() {
  const N = G.nodes, a = G.alpha, L = G.layout, D3 = G.dim === 3;
  const pullCat = L === "cluster" ? 0.06 : L === "mixed" ? 0.016 : 0;
  const pullGrp = L === "cluster" ? 0.08 : L === "mixed" ? 0.03 : 0.006;
  for (const n of N) { n.fx = 0; n.fy = 0; n.fz = 0; n._q = Math.sqrt(CHARGE[n.kind] || 1500); }
  for (let i = 0; i < N.length; i++) {
    const p = N[i];
    for (let j = i + 1; j < N.length; j++) {
      const q = N[j];
      if (p.pin && q.pin) continue;   // two pinned nodes can't move each other: skip the pair
      let dx = q.x - p.x, dy = q.y - p.y, dz = D3 ? q.z - p.z : 0;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 810000) continue;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = D3 ? Math.random() - 0.5 : 0; d2 = 1; }
      const d = Math.sqrt(d2);
      let f = (p._q * q._q) / d2;
      const minD = p.rr + q.rr + (p.kind !== "note" || q.kind !== "note" ? 30 : 14);
      if (d < minD) f += (minD - d) * 0.34;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      p.fx -= ux * f; p.fy -= uy * f; p.fz -= uz * f;
      q.fx += ux * f; q.fy += uy * f; q.fz += uz * f;
    }
  }
  for (const l of G.tree) {
    const p = l.s, q = l.t;
    const dx = q.x - p.x, dy = q.y - p.y, dz = D3 ? q.z - p.z : 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    let target, k = 0.035;
    const sp3 = D3 ? 1.45 : 1;
    if (q.kind === "realm") { target = (D3 ? 260 : 190) * sp3; k = 0.03; }
    else if (q.kind === "group") { target = (p.kind === "realm" ? (D3 ? 330 : 260) : 330) * sp3; k = 0.02; }
    else if (q.kind === "cat") { target = 170 * sp3; k = 0.025; }
    else if (p.kind === "cat") target = (60 + q.rr) * (D3 ? 1.35 : 1);
    else { target = (p.r + q.rr + 34) * (D3 ? 1.25 : 1); k = 0.05; }
    const f = (d - target) * k;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    p.fx += ux * f; p.fy += uy * f; p.fz += uz * f;
    q.fx -= ux * f; q.fy -= uy * f; q.fz -= uz * f;
  }
  for (const l of G.links) {
    if (l.type === "lens") continue;
    const p = l.s, q = l.t;
    const dx = q.x - p.x, dy = q.y - p.y, dz = D3 ? q.z - p.z : 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const target = p.rr + q.rr + (l.cross ? (L === "cluster" ? 220 : 90) : 60);
    const k = l.cross ? (L === "cluster" ? 0.002 : L === "mixed" ? 0.012 : 0.02) : (l.type === "ai" ? 0.01 + 0.01 * l.w : 0.02);
    const f = (d - target) * k;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    p.fx += ux * f; p.fy += uy * f; p.fz += uz * f;
    q.fx -= ux * f; q.fy -= uy * f; q.fz -= uz * f;
  }
  for (const n of N) {
    let an = null, pull = 0;
    if (n.kind === "group" || n.kind === "realm") { an = G.anchors.get(n.id); pull = pullGrp; }
    else if (n.kind === "cat") { an = G.anchors.get(n.id); pull = pullCat; }
    else if (n.kind === "note") { an = G.anchors.get("cat:" + n.ck); pull = pullCat * 0.22; }
    if (an && pull) { n.fx += (an.x - n.x) * pull; n.fy += (an.y - n.y) * pull; n.fz += (an.z - n.z) * pull; }
    const cg = D3 ? 0.0008 : 0.0015;
    n.fx -= n.x * cg; n.fy -= n.y * cg; n.fz -= n.z * cg;
  }
  for (const n of N) {
    if (n.pin) { n.vx = n.vy = n.vz = 0; continue; }
    n.vx = (n.vx + n.fx * a) * 0.6; n.vy = (n.vy + n.fy * a) * 0.6; n.vz = D3 ? (n.vz + n.fz * a) * 0.6 : 0;
    const sp = Math.hypot(n.vx, n.vy, n.vz);
    if (sp > 36) { n.vx *= 36 / sp; n.vy *= 36 / sp; n.vz *= 36 / sp; }
    n.x += n.vx; n.y += n.vy; n.z = D3 ? n.z + n.vz : 0;
  }
  G.alpha *= 0.986;
  if (G.alpha < 0.006) G.alpha = 0;
}
function settle(n) { G.alpha = 1; for (let i = 0; i < n && G.alpha > 0; i++) tick(); G.alpha = 0; placeLens(); syncPosts(); }
function syncPosts() {
  for (const p of G.posts) {
    if (p.free) continue;
    const n = G.byId.get(p.parentId); if (!n) continue;
    p.x = n.x + p.ox; p.y = n.y + p.oy; p.z = n.z + p.oz;
  }
}

/* ---------- camera ---------- */
function setRot() { const c = G.cam; G.rot = { cy: Math.cos(c.yaw), sy: Math.sin(c.yaw), cp: Math.cos(c.pitch), sp: Math.sin(c.pitch), cr: Math.cos(c.roll || 0), sr: Math.sin(c.roll || 0) }; }
function proj(x, y, z) {
  const c = G.cam;
  if (G.dim === 2) return { x: x * c.k + c.tx + G.W / 2, y: y * c.k + c.ty + G.H / 2, s: c.k, z: 0 };
  const R = G.rot || (setRot(), G.rot);
  const x1 = x * R.cy - z * R.sy, z1 = x * R.sy + z * R.cy;
  const y0 = y * R.cp - z1 * R.sp, z2 = y * R.sp + z1 * R.cp;
  const xr = x1 * R.cr - y0 * R.sr, yr = x1 * R.sr + y0 * R.cr;   // twist (roll) on screen
  const den = DIST + z2 * c.k, s = (FOCAL * c.k) / Math.max(NEAR * 0.5, den);
  return { x: xr * s + c.tx + G.W / 2, y: yr * s + c.ty + G.H / 2, s, z: z2, near: clamp((den - NEAR) / (NEAR * 4), 0, 1) };
}
// the node tree can be turned on its own (hand control) without moving the camera, so the floor stays level:
// G.treeM is a 3×3 rotation (row-major) about Capability Development, applied to tree points before the camera
const M3 = {
  I: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul: (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; },
  T: (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]],
  ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; },
  rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  cam: () => { const c = G.cam; return M3.mul(M3.rz(c.roll || 0), M3.mul(M3.rx(c.pitch), M3.ry(c.yaw))); },
  toQ: (m) => { const t = m[0] + m[4] + m[8]; let w, x, y, z;
    if (t > 0) { const S = Math.sqrt(t + 1) * 2; w = 0.25 * S; x = (m[7] - m[5]) / S; y = (m[2] - m[6]) / S; z = (m[3] - m[1]) / S; }
    else if (m[0] > m[4] && m[0] > m[8]) { const S = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / S; x = 0.25 * S; y = (m[1] + m[3]) / S; z = (m[2] + m[6]) / S; }
    else if (m[4] > m[8]) { const S = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / S; x = (m[1] + m[3]) / S; y = 0.25 * S; z = (m[5] + m[7]) / S; }
    else { const S = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / S; x = (m[2] + m[6]) / S; y = (m[5] + m[7]) / S; z = 0.25 * S; }
    return [w, x, y, z]; },
  fromQ: ([w, x, y, z]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  slerp: (a, b, t) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) { b = b.map((v) => -v); d = -d; }
    if (d > 0.9995) { const o = a.map((v, i) => v + (b[i] - v) * t), L = Math.hypot(...o); return o.map((v) => v / L); }
    const th = Math.acos(d), s0 = Math.sin((1 - t) * th) / Math.sin(th), s1 = Math.sin(t * th) / Math.sin(th); return a.map((v, i) => v * s0 + b[i] * s1); },
};
const treeOn = () => G.dim === 3 && !!G.treeM;
function treeW(x, y, z) { const M = G.treeM; return { x: M[0] * x + M[1] * y + M[2] * z, y: M[3] * x + M[4] * y + M[5] * z, z: M[6] * x + M[7] * y + M[8] * z }; }
function projT(x, y, z) { if (!treeOn()) return proj(x, y, z); const w = treeW(x, y, z); return proj(w.x, w.y, w.z); }
function untree(v) { if (!treeOn()) return v; const M = G.treeM; return { x: M[0] * v.x + M[3] * v.y + M[6] * v.z, y: M[1] * v.x + M[4] * v.y + M[7] * v.z, z: M[2] * v.x + M[5] * v.y + M[8] * v.z }; }
function setTreeM(M) {
  const id = Math.abs(M[0] - 1) + Math.abs(M[4] - 1) + Math.abs(M[8] - 1) < 1e-6;
  G.treeM = id ? null : M; kick();
}
// ease the tree back upright
function resetTree(dur = 650) {
  if (!G.treeM) return;
  G.treeAnim = { q0: M3.toQ(G.treeM), t0: performance.now(), dur };
  kick();
}
function unrot(xr, yr, z2) {
  const c = G.cam, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cr = Math.cos(c.roll || 0), sr = Math.sin(c.roll || 0);
  const x1 = xr * cr + yr * sr, y1 = -xr * sr + yr * cr;   // undo the twist first
  const y = y1 * cp + z2 * sp, z1 = -y1 * sp + z2 * cp;
  return { x: x1 * cy + z1 * sy, y, z: -x1 * sy + z1 * cy };
}
function fitCamera(instant, only, kMax) {
  const pts = only || [...G.nodes, ...G.posts];
  if (!pts.length || !G.W) return;
  setRot();
  const k0 = G.cam.k, tx0 = G.cam.tx, ty0 = G.cam.ty;
  const padX = G.W < 760 ? 60 : 50;
  let padTop = G.W < 760 ? 120 : 140;
  if (G.relate && !G.pulled && G.byId.has("lens")) { const dk = $("#deck"), wr = G.wrap.getBoundingClientRect(); if (dk && !dk.hidden && dk.offsetParent) { const b = dk.getBoundingClientRect(); if (b.height > 60) padTop = Math.max(padTop, b.bottom - wr.top + 56); } }
  const padBot = 64 + (TL.show ? (G.W < 760 ? 100 : 84) : 0);
  const D3 = G.dim === 3, whole = !only && D3;   // the whole map in 3D: the map's middle (Capability Development, or the centre of pillars / grid) in the middle of the screen
  let k = 1, box = null;
  for (let it = 0; it < (D3 ? 4 : 1); it++) {
    G.cam.k = k; G.cam.tx = 0; G.cam.ty = 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of pts) { const p = projT(n.x, n.y, n.z); const px = p.x - G.W / 2, py = p.y - G.H / 2; const r = (n.r || 3) * p.s; x0 = Math.min(x0, px - r - padX); x1 = Math.max(x1, px + r + padX); y0 = Math.min(y0, py - r - 40); y1 = Math.max(y1, py + r + 30); }
    if (whole) { const hx = Math.max(-x0, x1), hy = Math.max(-y0, y1); x0 = -hx; x1 = hx; y0 = -hy; y1 = hy; }
    box = { x0, x1, y0, y1 };
    k = clamp(k * Math.min((G.W - 40) / (x1 - x0), (G.H - padTop - padBot) / (y1 - y0)), 0.04, kMax || 2.4);
  }
  // with the camera at k, the box measured at the previous k scales by roughly k / kPrev
  const kPrev = G.cam.k, f = k / kPrev;
  const to = whole ? { k, tx: 0, ty: (padTop - padBot) / 2, yaw: G.cam.yaw, pitch: G.cam.pitch, ...(GX.on ? {} : { roll: 0 }) }
    : { k, tx: -f * (box.x0 + box.x1) / 2, ty: -f * (box.y0 + box.y1) / 2 + (padTop - padBot) / 2, yaw: G.cam.yaw, pitch: G.cam.pitch };
  G.cam.k = k0; G.cam.tx = tx0; G.cam.ty = ty0;
  animateCam(to, instant ? 0 : 650);
}
function descendantsOf(id) {
  const out = [];
  for (const m of G.nodes) { let q = m; while (q && q.tp) { if (q.tp === id) { out.push(m); break; } q = G.byId.get(q.tp); } }
  const ids = new Set([id, ...out.map((m) => m.id)]);
  for (const p of G.posts) if (ids.has(p.parentId)) out.push(p);
  return out;
}
function frameSelected() {
  const id = G.selected;
  const n = id && nodeData(id);
  if (!n) { fitCamera(false); toast("Framed the whole network"); return; }
  let pts;
  if (G.pulled && (G.pulled.root === id || G.pulled.members.includes(id))) pts = [nodeData(G.pulled.root), ...G.pulled.members.map(nodeData), ...G.pulled.posts.map(nodeData)];
  else if (n.kind === "post") pts = [n, G.byId.get(n.parentId)];
  else if (n.kind === "lens" && G.relate) pts = [n, ...G.relate.top.map((x) => G.byId.get(x)), ...[...G.relate.posts].map((x) => G.postById.get(x))];
  else pts = [n, ...descendantsOf(id)];
  pts = pts.filter(Boolean);
  fitCamera(false, pts, pts.length < 4 ? 3.5 : 4);
}
function animateCam(to, dur) {
  if (!dur || reduceMotion) { Object.assign(G.cam, to); G.camAnim = null; updateStatus(); kick(); return; }
  G.camAnim = { from: { ...G.cam }, to: { ...G.cam, ...to }, t0: performance.now(), dur };
  kick();
}
function centerOn(id) {
  const n = nodeData(id);
  if (!n) return;
  setRot();
  const p = projT(n.x, n.y, n.z);
  animateCam({ tx: G.cam.tx - (p.x - G.W / 2) + (G.W > 900 ? -120 : 0), ty: G.cam.ty - (p.y - G.H / 2) }, 550);
}
function zoomBy(f, cx = G.W / 2, cy = G.H / 2) {
  const c = G.cam;
  if (G.dim === 3 && !G.pulled) { const o = proj(0, 0, 0); cx = o.x; cy = o.y; }   // 3D: zoom toward the middle of the map (Capability Development in free / explode, the chart centre in pillars / grid)
  const nk = clamp(c.k * f, 0.04, G.dim === 3 ? 5 : 8);   // 3D: the dolly stops before flying through the middle
  const r = nk / c.k;
  c.tx = (cx - G.W / 2) - ((cx - G.W / 2) - c.tx) * r;
  c.ty = (cy - G.H / 2) - ((cy - G.H / 2) - c.ty) * r;
  c.k = nk;
  updateStatus(); kick();
}

const BORN_MS = 780;
/* ---------- loop ---------- */
function kick() { if (!G.raf) G.raf = requestAnimationFrame(frame); }
function frame(t) {
  G.raf = 0;
  let active = false;
  if (G.alpha > 0) { tick(); active = true; if (G.relate && G.relate.lens) placeLens(); }
  if (G.treeAnim) {
    const k = Math.min(1, (t - G.treeAnim.t0) / G.treeAnim.dur);
    setTreeM(k >= 1 ? M3.I() : M3.fromQ(M3.slerp(G.treeAnim.q0, [1, 0, 0, 0], easeInOut(k))));
    if (k >= 1) G.treeAnim = null;
    active = true;
  }
  if (G.camAnim) {
    const k = Math.min(1, (t - G.camAnim.t0) / G.camAnim.dur), e = easeInOut(k);
    for (const key of ["k", "tx", "ty", "yaw", "pitch", "roll"]) G.cam[key] = (G.camAnim.from[key] || 0) + ((G.camAnim.to[key] ?? G.camAnim.from[key] ?? 0) - (G.camAnim.from[key] || 0)) * e;
    if (k >= 1) { G.camAnim = null; updateStatus(); }
    active = true;
  }
  if (G.anims.length) {
    const now = performance.now();
    G.anims = G.anims.filter((a) => {
      const k = clamp((now - a.t0) / a.dur, 0, 1), e = a.ease(k);
      const to = typeof a.to === "function" ? a.to() : a.to;
      a.n.x = a.from.x + (to.x - a.from.x) * e; a.n.y = a.from.y + (to.y - a.from.y) * e; a.n.z = a.from.z + (to.z - a.from.z) * e;
      if (k >= 1) { a.done && a.done(); return false; }
      return true;
    });
    active = true;
  }
  if (G.dim === 3 && G.spin && !reduceMotion && !G.drag && !G.pulled && !G.camAnim && !GX.on && st.view === "graph") { G.cam.yaw += 0.0012; active = true; }
  if (G.pulses.length) { G.pulses = G.pulses.filter((p) => t - p.t0 < 900); active = true; }
  if (G.lit && G.lit.size && !reduceMotion && st.view === "graph") active = true;
  if (G.fitAfter && t > G.fitAfter) { G.fitAfter = 0; fitCamera(false); }
  if (G.fitAfter) active = true;
  if (bandStep() || holdStep()) active = true;
  syncPosts();
  render(t);
  if (G.folding || G.labAnim) active = true;
  placePreview();
  placeNetCtl();
  placePinChip();
  if (active || G.drag) kick();
}

/* ---------- drawing ---------- */
function render(t) {
  const ctx = G.ctx, W = G.W, H = G.H;
  if (!ctx || !W) return;
  t = t || performance.now();
  setRot();
  const D3 = G.dim === 3;
  const TR = D3 && G.treeM;
  let maxY = 0, maxW = 0;
  for (const n of G.nodes) { maxY = Math.max(maxY, n.y + (n.rr || 0)); n._w = TR ? treeW(n.x, n.y, n.z) : n; maxW = Math.max(maxW, n._w.y + (n.rr || 0)); }
  const fy = Math.max(maxY, maxW) + 90;
  G.floorY = !TR || !G.floorY || Math.abs(G.floorY - fy) > 4000 ? fy : G.floorY + (fy - G.floorY) * (fy > G.floorY ? 0.12 : 0.02);
  const sel = G.selected, lit = G.lit, pulled = G.pulled;
  const all = G.nodes.concat(G.posts);
  for (const n of all) n._p = TR ? projT(n.x, n.y, n.z) : proj(n.x, n.y, n.z);
  // fold: nodes outside the selected depth collapse into the selected node (and expand back out)
  const keep = sel && !pulled && G.netLevel < 3 && nodeData(sel) ? netSetCached(sel, G.netLevel) : null;
  if (keep) G.foldAt = sel;
  const anchor = G.foldAt && nodeData(G.foldAt);
  const dt = Math.min(64, Math.max(0, t - (G.lastT || t))); G.lastT = t;
  const step = reduceMotion ? 1 : dt / 520;
  let folding = false;
  for (const n of all) {
    const target = keep && !keep.has(n.id) ? 1 : 0;
    let c = n._c || 0;
    if (c !== target) { c = target > c ? Math.min(target, c + step) : Math.max(target, c - step); folding = true; }
    n._c = c;
    if (c > 0 && anchor && anchor._p && n !== anchor) {
      const e2 = easeInOut(c), ap = anchor._p, p = n._p;
      n._p = { x: p.x + (ap.x - p.x) * e2, y: p.y + (ap.y - p.y) * e2, s: p.s * (1 - 0.8 * e2), z: p.z };
    }
  }
  if (!folding && !keep) G.foldAt = null;
  // timeline playback: a newly born node grows out of its parent (its link stretches out with it) instead of popping in
  const nowB = performance.now();
  const born = all.filter((n) => n._born);
  if (born.length) {
    born.sort((a, b) => (a.depth || 0) - (b.depth || 0));
    for (const n of born) {
      const k = (nowB - n._born) / BORN_MS;
      if (k >= 1) { n._born = 0; n._grow = 1; continue; }
      const par = n.kind === "post" ? G.byId.get(n.parentId) : G.byId.get(n.tp);
      const e = 1 - Math.pow(1 - clamp(k, 0, 1), 3);
      n._grow = e;
      if (!par || !par._p) continue;
      const pp = par._p, p = n._p;
      n._p = { x: pp.x + (p.x - pp.x) * e, y: pp.y + (p.y - pp.y) * e, s: p.s * (0.3 + 0.7 * e), z: p.z };
      folding = true;
    }
  }
  G.folding = folding;
  const s0 = D3 ? (FOCAL / DIST) * G.cam.k : G.cam.k;
  const depthA = (p) => (D3 ? clamp(0.3 + 0.7 * (p.s / s0) ** 1.5, 0.22, 1) * (p.near ?? 1) : 1);
  const inGroup = pulled ? (inPulledGroup(pulled.root), pulled.set) : null;
  const near = keep;
  const fade = (n) => 1 - (n._c || 0);
  const visible = (id) => {
    if (inGroup) return inGroup.has(id);
    if (near) return near.has(id);
    if (lit) return lit.has(id);
    return true;
  };
  const onScreen = (p, r) => p.x > -r - 40 && p.x < W + r + 40 && p.y > -r - 40 && p.y < H + r + 40;
  // fewer satellites when zoomed out: a few posts per topic, the rest appear as you zoom in
  const capN = s0 < 0.3 ? 2 : s0 < 0.55 ? 5 : s0 < 0.9 ? 12 : Infinity;
  for (const p of G.posts) {
    p._hid = !(p.idx < capN || p.free || p.id === sel || p.id === G.hover || p.parentId === sel || p.parentId === G.hover
      || (G.litPosts && G.litPosts.has(p.id)) || (inGroup && inGroup.has(p.id)));
  }
  // focus mode (a node shaken open): everything else goes to a blurred background canvas underneath
  const focus = !!inGroup && !!G.bgCtx;
  const tLive = t;
  if (focus !== !!G.focusOn) { G.focusOn = focus; G.bgT = t; G.wrap.classList.toggle("focus", focus); renderFocusBar(); if (!focus) { G.bgCtx.setTransform(1, 0, 0, 1, 0, 0); G.bgCtx.clearRect(0, 0, G.bgCv.width, G.bgCv.height); } }
  const scene = (ctx, layer) => {
  // the blurred background is frozen in time: nothing pulses or travels along its links
  const t = layer === "bg" ? G.bgT || tLive : tLive;
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const want = (id) => layer === "all" || (layer === "fg" ? inGroup.has(id) : !inGroup.has(id));
  const wantL = (a, b) => layer === "all" || (layer === "fg" ? inGroup.has(a) && inGroup.has(b) : !(inGroup.has(a) && inGroup.has(b)));
  const bgLayer = layer === "bg";
  if (layer !== "fg") { drawGrid(ctx); drawBackdrops(ctx, fade); }
  // floor shadows
  if (D3 && layer !== "fg") {
    const sh = shadowSprite();
    for (const n of G.nodes) {
      if ((n._c || 0) > 0.98) continue;
      const wp = n._w || n, fp = proj(wp.x, G.floorY, wp.z);
      if (fp.s <= 0 || !onScreen(fp, 60)) continue;
      const hgt = clamp(1 - (G.floorY - wp.y) / 1400, 0.15, 1);
      const w = dR(n) * fp.s * (2.6 + (1 - hgt) * 2.2), hh = w * (0.18 + Math.abs(Math.sin(G.cam.pitch)) * 0.5);
      ctx.globalAlpha = (visible(n.id) ? 0.55 : 0.18) * hgt * depthA(fp) * fade(n);
      ctx.drawImage(sh, fp.x - w / 2, fp.y - hh / 2, w, hh);
      if (n.kind === "group" || n.kind === "core" || n.kind === "realm") {
        ctx.globalAlpha *= 0.6;
        ctx.strokeStyle = rgba(n.color, 0.35); ctx.setLineDash([2, 5]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(n._p.x, n._p.y + dR(n) * n._p.s); ctx.lineTo(fp.x, fp.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.lineCap = "round";
  const zw = (a, b, lo, hi) => clamp(Math.sqrt((a.s + b.s) / 2 / s0), lo, hi);
  const dimA = bgLayer ? 0.5 : near && !inGroup ? 0.06 : 0.15;
  // links: colour-coded curves that bundle — each parent's links leave it together (pointing away from
  // its own parent) before fanning out; related-note links bend toward their shared ancestor
  const curve = (a, c, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke(); };
  ctx.globalCompositeOperation = "lighter";
  const batches = new Map();
  for (const l of G.tree) {
    const a = l.s._p, b = l.t._p;
    if (!wantL(l.s.id, l.t.id) || l.s._tl || l.t._tl) continue;
    l._cp = null;
    if (pulled && pulled.tidy && l.t._route && inGroup.has(l.s.id) && inGroup.has(l.t.id)) continue;
    if (!onScreen(a, 400) && !onScreen(b, 400)) continue;
    // only the main-topic levels curve (core → group → category); everything below stays straight
    // (in focus mode the opened tree is drawn straight, so its branches never cross)
    l._cp = (l.t.kind === "group" || l.t.kind === "cat" || l.t.kind === "realm") && !(inGroup && inGroup.has(l.s.id) && inGroup.has(l.t.id)) ? treeCtrl(l) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const both = visible(l.s.id) && visible(l.t.id);
    const hot = (lit && both) || (inGroup && both) || (sel && (l.s.id === sel || l.t.id === sel));
    let al = hot ? 0.85 : 0.38;
    if (!both) al = 0.38 * dimA;
    al *= Math.min(depthA(a), depthA(b)) * Math.min(fade(l.s), fade(l.t)) * (0.35 + 0.65 * Math.min(l.s._grow ?? 1, l.t._grow ?? 1));
    if (al < 0.004) continue;
    const lvlW = l.t.kind === "realm" ? 1.8 : l.t.kind === "group" ? 1.5 : l.t.kind === "cat" ? 1.25 : 0.95;
    const w = lvlW * zw(a, b, 0.8, 1.8) * (hot ? 1.25 : 1);
    if (l.s.kind === "core") {
      // core spokes: white at the core fading into the group hue
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, rgba("#dff6ff", al * 0.7)); g.addColorStop(1, rgba(l.t.color, al));
      ctx.strokeStyle = g; ctx.lineWidth = w; curve(a, l._cp, b);
      continue;
    }
    // batch by colour + quantised alpha/width so hundreds of links cost a few strokes
    const qa = Math.max(1, Math.round(al * 20)), qw = Math.max(1, Math.round(w * 4));
    const key = l.t.color + "|" + qa + "|" + qw;
    let B = batches.get(key);
    if (!B) batches.set(key, (B = { col: l.t.color, al: qa / 20, w: qw / 4, segs: [] }));
    B.segs.push(a, l._cp, b);
  }
  for (const B of batches.values()) {
    ctx.beginPath();
    for (let i = 0; i < B.segs.length; i += 3) { const a = B.segs[i], c = B.segs[i + 1], b = B.segs[i + 2]; ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); }
    ctx.strokeStyle = rgba(B.col, B.al * 0.16); ctx.lineWidth = B.w * 4; ctx.stroke();   // soft glow
    ctx.strokeStyle = rgba(B.col, B.al); ctx.lineWidth = B.w; ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  // note links (manual + AI): bundled along the hierarchy (each link bends through its topics' ancestors, pulled
  // most of the way toward them), then drawn additively — where many run together the bundle glows like a heatmap.
  // Lens links stay as moving dashes; highlighted links are drawn on top in full colour.
  const anc = new Map();
  const ancOf = (n) => {
    if (anc.has(n.id)) return anc.get(n.id);
    const out = []; let q = n.tp ? G.byId.get(n.tp) : null;
    while (q) { out.push(q); q = q.tp ? G.byId.get(q.tp) : null; }
    anc.set(n.id, out); return out;
  };
  const BETA = 0.84, MAXBOW = 0.16;
  const bundlePath = (l) => {
    const A = ancOf(l.s), B = ancOf(l.t), Bi = new Map(B.map((q, i) => [q.id, i]));
    let ia = A.findIndex((q) => Bi.has(q.id) || q === l.t), pts;
    if (ia < 0 || A[ia] === l.t || Bi.has(l.s.id)) pts = [l.s._p, l.t._p];
    else {
      const ib = Bi.get(A[ia].id);
      // only bend through ancestors that are where they appear (not the ones left behind by an open focus)
      const via = [...A.slice(0, ia + 1), ...B.slice(0, ib).reverse()].filter((q) => q._p && (!inGroup || inGroup.has(q.id)) && !q._tl);
      pts = [l.s._p, ...via.map((q) => q._p), l.t._p];
    }
    const n = pts.length; if (n < 3) return pts;
    // one smooth arc per link (never an S-bend or a loop): it leans toward the shared ancestors, so related links
    // still gather into soft bundles, but the bow is capped at MAXBOW × the link's length
    const p0 = pts[0], pn = pts[n - 1], mx = (p0.x + pn.x) / 2, my = (p0.y + pn.y) / 2, D = Math.hypot(pn.x - p0.x, pn.y - p0.y) || 1;
    let ax = 0, ay = 0;
    for (let i = 1; i < n - 1; i++) { ax += pts[i].x; ay += pts[i].y; }
    ax = ax / (n - 2) - mx; ay = ay / (n - 2) - my;
    const len = Math.hypot(ax, ay), cap = 2 * MAXBOW * D;   // a quadratic bows half as far as its control point
    const k = len > 0 ? Math.min(BETA, cap / len) : 0;
    if (k * len < 3) return [p0, pn];
    return [p0, { x: mx + ax * k, y: my + ay * k }, pn];
  };
  const tracePath = (pts) => {
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
    for (let i = 1; i < pts.length - 2; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    const k = pts.length - 2; ctx.quadraticCurveTo(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
  };
  const bundles = new Map(), hotLinks = [];
  for (const l of G.links) {
    if (l.type === "ai" && !G.showAI) continue;
    if (l.type !== "lens" && !G.showRel) continue;
    if (!wantL(l.s.id, l.t.id) || l.s._tl || l.t._tl) continue;
    if (inGroup && inGroup.has(l.s.id) !== inGroup.has(l.t.id)) continue;
    if (pulled && pulled.tidy && l.type !== "lens") { const f = G.hover || (sel !== pulled.root ? sel : null); if (!f || (l.s.id !== f && l.t.id !== f)) continue; }
    const a = l.s._p, b = l.t._p;
    if (!onScreen(a, 600) && !onScreen(b, 600)) continue;
    const both = visible(l.s.id) && visible(l.t.id);
    const tidy = !!(pulled && pulled.tidy);
    const hot = (sel && sel !== "lens" && (l.s.id === sel || l.t.id === sel)) || (lit && both && l.type !== "lens" && !tidy);
    if (l.type === "lens") {
      let al = 0.65 * Math.min(depthA(a), depthA(b)) * Math.min(fade(l.s), fade(l.t)) * Math.min(l.s._grow ?? 1, l.t._grow ?? 1);
      if (al < 0.004) continue;
      ctx.strokeStyle = rgba(LENS_COL, al); ctx.lineWidth = zw(a, b, 0.8, 1.6); ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = !reduceMotion ? -((t / 1000) * 18) % 8 : 0;
      ctx.beginPath();
      if (pulled && pulled.tidy && inGroup && inGroup.has(l.t.id)) { ctx.setLineDash([]); continue; }   // drawn as connectors below
      { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    let al = l.type === "ai" ? 0.34 : 0.4;
    if (l.cross && !hot) al *= G.arrange !== "free" ? 0.3 : 0.75;   // tidy arrangements: cross-topic links stay in the background
    if (!both) al *= dimA;
    al *= Math.min(depthA(a), depthA(b)) * Math.min(fade(l.s), fade(l.t)) * Math.min(l.s._grow ?? 1, l.t._grow ?? 1);
    if (al < 0.004) continue;
    const pts = bundlePath(l);
    const w = (l.type === "ai" ? 0.9 : 1.1) * zw(a, b, 0.8, 1.6);
    if (hot) { hotLinks.push({ l, pts, al: l.type === "ai" ? 0.85 : 0.92, w: w * 1.3 }); continue; }
    // colour-coded: each relation runs from its own topic's colour to the other end's colour
    bundles.set(bundles.size, { pts, al, w, ai: l.type === "ai", c0: l.s.color, c1: l.t.color });
  }
  // tidy search layouts (pillars / grid): connectors run along the gutters with rounded corners —
  // a spine per pillar (sub-topics on their own inner spine), or a comb for the grid
  if (pulled && pulled.tidy && layer !== "bg") {
    const R = G.byId.get(pulled.root);
    ctx.setLineDash([]); ctx.lineWidth = 1;
    for (const id of pulled.members) {
      const m = G.byId.get(id); if (!m || !m._route || !m._p || !R) continue;
      const S = G.byId.get(m._rsrc); if (!S || !S._p) continue;
      const al = 0.55 * Math.min(fade(S), fade(m)) * Math.min(S._grow ?? 1, m._grow ?? 1) * (sel && sel !== R.id && sel !== id && sel !== S.id ? 0.5 : 1);
      if (al < 0.004) continue;
      ctx.strokeStyle = S === R ? rgba(LENS_COL, al) : rgba(S.color || LENS_COL, al);
      const pts = [S._p, ...m._route.map((o) => projT(R.x + o.x, R.y + o.y, R.z + o.z)), m._p];
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) ctx.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, 10);
      ctx.lineTo(m._p.x, m._p.y); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "lighter";
  for (const B of bundles.values()) {
    const a = B.pts[0], b = B.pts[B.pts.length - 1];
    const core = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    core.addColorStop(0, rgba(B.c0, B.al * 0.8)); core.addColorStop(1, rgba(B.c1, B.al * 0.8));
    ctx.beginPath(); tracePath(B.pts);
    ctx.strokeStyle = core; ctx.lineWidth = B.w; ctx.setLineDash(B.ai ? [4, 6] : []); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.globalCompositeOperation = "source-over";
  for (const H of hotLinks) {
    const { l, pts } = H, a = pts[0], b = pts[pts.length - 1];
    if (l.type === "ai") { ctx.strokeStyle = rgba("#ff4fd8", H.al); ctx.setLineDash([4, 6]); }
    else { const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, rgba(l.s.color, H.al)); g.addColorStop(1, rgba(l.t.color, H.al)); ctx.strokeStyle = g; }
    ctx.lineWidth = H.w; ctx.beginPath(); tracePath(pts); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // post tethers (very faint; brighter when lit, selected or pulled)
  if (G.posts.length) {
    for (const p of G.posts) {
      const par = G.byId.get(p.parentId); if (!par) continue;
      if (!want(p.id) || p._hid || p._tl) continue;
      const a = par._p, b = p._p;
      if (!onScreen(b, 20)) continue;
      const hot = (G.litPosts && G.litPosts.has(p.id)) || p.id === sel || p.id === G.hover || p.free || (sel === par.id);
      if (!hot && G.cam.k * (D3 ? FOCAL / DIST : 1) < 0.7) continue;
      if ((p._c || 0) > 0.98) continue;
      ctx.strokeStyle = rgba(par.color, (hot ? 0.45 : 0.12) * fade(p));
      ctx.lineWidth = hot ? 0.8 : 0.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  // pulse wave travelling out from the core along highlighted paths
  const wave = lit && lit.size && !reduceMotion ? (t - G.waveT0) % WAVE_EVERY : -1;
  if (wave >= 0 && !bgLayer && !(pulled && pulled.tidy)) drawWave(ctx, wave, s0, layer === "fg" ? inGroup : null);
  // nodes, far to near
  const items = all.filter((n) => (n._c || 0) < 0.985 && !n._hid && !n._tl && want(n.id) && onScreen(n._p, (n.rr || n.r) * n._p.s));
  const rank = (n) => (n.kind === "note" && n.hub ? 2 : n.kind === "post" && n.free ? 3.5 : DRAW_RANK[n.kind] || 0);
  // 3D: far to near, but Capability Development is always drawn on top
  if (D3) items.sort((A, B) => (A.kind === "core") - (B.kind === "core") || B._p.z - A._p.z);
  else items.sort((A, B) => rank(A) - rank(B));
  // how much text to show: 0 main topics · 1 + categories · 2 + key topics · 3 + all topics · 4 + post names.
  // Auto picks the level from the zoom (and opens up a step in focus mode); levels fade in rather than pop.
  const zk0 = G.cam.k * (D3 ? FOCAL / DIST : 1);
  const autoL = clamp(interp([[0.25, 0.4], [0.45, 1.2], [0.75, 2.1], [1.15, 3], [1.8, 4]], zk0) + (inGroup ? 1.2 : 0), 0, 4);
  if (Math.round(autoL) !== G.autoLvl) { G.autoLvl = Math.round(autoL); if (G.labelAuto) syncLabelUi(); }
  const LF = G.labelAuto ? autoL : G.labelLvl;
  const tierA = (tier) => clamp(LF - tier + 1, 0, 1);
  const labels = [];
  for (const n of items) {
    const p = n._p;
    const isPost = n.kind === "post";
    const vis = isPost ? (inGroup ? inGroup.has(n.id) : near ? near.has(n.id) : lit ? (G.litPosts && G.litPosts.has(n.id)) : true) : visible(n.id);
    const da = depthA(p);
    const hov = n.id === G.hover;
    let pop = 1;
    if (n._born) pop = 0.35 + 0.65 * (n._grow || 0);
    const r = pop * Math.max(isPost ? 1.6 : 3, dR(n) * p.s * (isPost && (n.free || hov) ? 1.6 : 1)) * (hov && !isPost ? 1.04 : 1);
    const a0 = (vis ? 1 : bgLayer ? 0.5 : near && !inGroup ? (isPost ? 0.03 : 0.06) : 0.15) * da * fade(n);
    ctx.globalAlpha = a0;
    if (isPost) {
      const tileW = Math.min(64, n.free ? clamp(27 * p.s, 5, 96) : r * 3.2);
      const img = tileW >= 18 && G.thumbs ? thumbOf(n.code) : null;
      const ok = img && G.sheetImgs[img.sh] && G.sheetImgs[img.sh].complete && G.sheetImgs[img.sh].naturalWidth;
      const mixT = ok ? clamp((tileW - 18) / 6, 0, 1) : 0;   // crossfade dot -> tile between 18 and 24px
      const lp = G.litPosts && G.litPosts.has(n.id);
      if (mixT < 1) {
        ctx.globalAlpha = a0 * (1 - mixT);
        const bc = lp ? mix(n.color, "#ffffff", 0.35) : n.color;
        ctx.drawImage(r < 8 ? ballSmall(bc) : ballSprite(bc), p.x - r, p.y - r, r * 2, r * 2);
        n._hr = r + 3;
      }
      if (mixT > 0) {
        const T = G.thumbs.t, w = tileW, rad = Math.min(6, w * 0.18);
        ctx.globalAlpha = a0 * mixT;
        ctx.save();
        ctx.beginPath(); roundRect(ctx, p.x - w / 2, p.y - w / 2, w, w, rad); ctx.clip();
        ctx.drawImage(G.sheetImgs[img.sh], img.col * T, img.row * T, T, T, p.x - w / 2, p.y - w / 2, w, w);
        ctx.restore();
        const hotT = n.id === sel || hov || lp;
        ctx.strokeStyle = hotT ? "rgba(56,225,255,.9)" : rgba(mix(n.color, "#e1edf5", 0.5), 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath(); roundRect(ctx, p.x - w / 2 + 0.5, p.y - w / 2 + 0.5, w - 1, w - 1, rad); ctx.stroke();
        n._hr = w / 2 + 2;
      }
    } else {
      const glow = n.kind === "core" || n.kind === "group" || n.kind === "realm" || n.kind === "lens" || n.kind === "cat" || (n.hub && vis);
      if (glow) {
        const gw = r * (n.kind === "core" ? 4.2 : n.kind === "realm" ? 3.9 : n.kind === "group" ? 3.6 : 2.8);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a0 * (vis ? (n.kind === "cat" ? 0.55 : 0.85) : 0.25);
        ctx.drawImage(glowSprite(n.color), p.x - gw / 2, p.y - gw / 2, gw, gw);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = a0;
      }
      if (!D3) { ctx.globalAlpha = a0 * 0.5; ctx.drawImage(shadowSprite(), p.x - r * 1.1 + r * 0.35, p.y - r * 1.1 + r * 0.55, r * 2.2, r * 2.2); ctx.globalAlpha = a0; }
      ctx.drawImage(ballSprite(n.color), p.x - r, p.y - r, r * 2, r * 2);
      if (D3 && da < 0.95) { ctx.globalAlpha = (1 - da) * 0.55; ctx.fillStyle = "#04070d"; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = a0; }
      n._hr = Math.max(9, r + 5);
      if (n.kind === "core" || n.kind === "group" || n.kind === "realm" || n.kind === "lens") drawOrbit(ctx, n, t, (vis ? 1 : 0.3) * fade(n) * (p.near ?? 1));
      else if (n.hub && n.kind === "note") {
        ctx.strokeStyle = rgba(n.color, 0.7 * (vis ? 1 : 0.4)); ctx.lineWidth = 1.1; ctx.setLineDash([3, 4]);
        ctx.lineDashOffset = -(t / 60) % 14;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5 * Math.max(0.6, p.s), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      // highlighted (search match): thin cyan outline
      if (lit && lit.has(n.id) && vis && n.id !== sel && !hov && n.kind !== "core") {
        ctx.globalAlpha = a0 * 0.5; ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = a0;
      }
    }
    if (hov && n.id !== sel) {
      ctx.globalAlpha = Math.max(0.5, a0) * 0.65; ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 1;
      const hr = isPost ? (n._hr || r) + 1 : r + 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = a0;
    }
    if (n.id === sel) { ctx.globalAlpha = 1; drawBrackets(ctx, p.x, p.y, isPost ? (n._hr || r) + 3 : r + 5, r * 2); ctx.globalAlpha = a0; }
    if (pulled && n.id === pulled.root && !bgLayer) {
      // focus mode: the parent of the opened tree sits in a framed box
      const b = r + 14;
      ctx.globalAlpha = 1; ctx.strokeStyle = rgba(n.color, 0.9); ctx.lineWidth = 1.5; ctx.fillStyle = rgba(n.color, 0.07);
      ctx.beginPath(); roundRect(ctx, p.x - b, p.y - b, b * 2, b * 2, 8); ctx.fill(); ctx.stroke();
      ctx.font = `600 9px ${getVar("--font-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillStyle = rgba(n.color, 0.95); if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
      ctx.fillText("PARENT", p.x, p.y - b - 4); if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.globalAlpha = a0;
    }
    if ((n.userPin && !n.userPin.by) || (G.pinOffer && G.pinOffer.id === n.id)) drawPin(ctx, p.x + r * 0.72, p.y - r * 0.72, !!n.userPin, a0);
    else if (n.userPin && n.userPin.by && !isPost) { ctx.globalAlpha = Math.max(0.5, a0) * 0.8; ctx.fillStyle = "#ff5c8a"; ctx.beginPath(); ctx.arc(p.x + r * 0.75, p.y - r * 0.75, 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = a0; }
    // labels
    const kind = n.kind;
    let show;
    const must = n.id === sel || n.id === G.hover || kind === "core" || kind === "realm" || kind === "group" || kind === "lens" || (inGroup && n.id === pulled.root) || (pulled && pulled.tidy && !isPost && inGroup.has(n.id));
    const tier = kind === "cat" ? 1 : isPost ? 4 : n.hub ? 2 : 3;
    let ta = must ? 1 : tierA(tier);
    if (!must && !isPost && kind !== "cat" && vis && (near || lit) && !inGroup) ta = Math.max(ta, 1);   // search matches / selected neighbourhood stay readable
    if (isPost && !must && (n._hr || 0) < 14) ta = 0;   // post names only once tiles are big enough to read
    show = ta > 0.03;
    if (!show || (!vis && n.id !== G.hover)) continue;
    const ps = Math.sqrt(p.s / s0), zk = ps * Math.sqrt(G.cam.k);
    const DSP = getVar("--font-display"), BODY = getVar("--font-body"), MONO = getVar("--font-mono");
    let fs, font, fill = "#e1edf5", txt = n.title, sub = null, prio = 10, dy = r + 6, trk = 0;
    if (kind === "core") { fs = clamp(18 * zk, 13, 24); font = `600 ${fs}px ${DSP}`; txt = n.title.toUpperCase(); trk = 0.7; prio = 200; if (D3) { fs = clamp(21 * zk, 15, 28); font = `700 ${fs}px ${DSP}`; } sub = `${st.notes.size} NOTES · ${G.posts.length} POSTS`; dy = r * 1.4 + 8; }
    else if (kind === "realm") { fs = clamp(17 * zk, 13, 25); font = `600 ${fs}px ${DSP}`; txt = n.title.toUpperCase(); trk = 1.1; fill = mix(n.color, "#ffffff", 0.35); prio = 111; sub = realmStats(n); dy = r * 1.3 + 8; }
    else if (kind === "group") { fs = clamp(16 * zk, 12, 24); font = `600 ${fs}px ${DSP}`; txt = n.title.toUpperCase(); trk = 0.8; fill = mix(n.color, "#e1edf5", 0.25); prio = 110; sub = `${groupStats(n.grp)}`; dy = r + 9; }
    else if (kind === "cat") { fs = clamp(12 * zk, 9.5, 16); font = `500 ${fs}px ${DSP}`; txt = n.title.toUpperCase(); trk = 0.5; fill = mix(n.color, "#e1edf5", 0.55); prio = 95; dy = r + 7; }
    else if (kind === "lens") { fs = clamp(14 * ps, 11, 18); font = `600 ${fs}px ${DSP}`; txt = short(n.title, 40); trk = 0.4; fill = LENS_COL; prio = 130; sub = G.relate ? `${G.relate.top.length} TOPICS · ${G.relate.posts.size} POSTS · SHAKE TO GATHER` : null; dy = r * 1.4 + 8; }
    else if (isPost) { fs = 10.5; font = `400 ${fs}px ${MONO}`; txt = n.name ? short(n.name, 28) : n.handle ? "@" + n.handle : short(n.title, 24); fill = "#c9d7e3"; prio = hov ? 85 : 40; dy = (n._hr || r) + 4; }
    else { fs = n.hub ? clamp(13 * zk, 10, 18) : clamp(12 * ps, 9, 14); font = n.hub ? `500 ${fs}px ${BODY}` : `400 ${fs}px ${BODY}`; txt = short(n.name || n.title, Math.min(n.hub ? 34 : 30, pulled && pulled.tidy && n._labCap ? n._labCap : 99)); fill = n.hub ? "#e1edf5" : "#c3d2df"; prio = n.hub ? 50 : 12; dy = n.hub && r * 2 >= 16 ? r * 1.32 + 5 : r + 6; }
    if (n.id === sel) prio += 60; else if (n.id === G.hover) prio += 45;
    if (D3) prio += p.s;
    labels.push({ id: n.id, prio, x: p.x, y: p.y + dy, txt, font, fill, trk, alpha: Math.max(ctx.globalAlpha, vis ? 0.85 * da : 0.3) * ta, h: fs * 1.25, top: true, sub: ta > 0.6 ? sub : null, subFont: `400 ${clamp(fs * 0.6, 9, 11)}px ${MONO}` });
  }
  ctx.globalAlpha = 1;
  placeLabels(ctx, labels, layer);
  for (const pu of bgLayer ? [] : G.pulses) {
    const n = nodeData(pu.id); if (!n || !n._p) continue;
    const p = n._p, k = (t - pu.t0) / 900;
    ctx.strokeStyle = `rgba(56,225,255,${0.85 * (1 - k)})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, dR(n) * p.s + 3 + k * 40, 0, Math.PI * 2); ctx.stroke();
  }
  };
  if (focus) { scene(G.bgCtx, "bg"); scene(G.ctx, "fg"); }
  else scene(G.ctx, "all");
}
// convex hull (monotone chain)
function hull(P) {
  const p = P.slice().sort((a, b) => a.x - b.x || a.y - b.y), cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function realmStats(n) {
  if (n._stats && n._statsV === G.dataV) return n._stats;
  const gs = G.nodes.filter((g) => g.tp === n.id);
  let posts = 0; for (const m of G.nodes) if (m.kind === "note" && REALM_SET.has(m.grp)) posts += (m.posts || []).length;
  n._statsV = G.dataV; return (n._stats = `${gs.length} GROUPS · ${posts} POSTS`);
}
const GSTATS = new Map();
function groupStats(g) {
  const hit = GSTATS.get(g); if (hit && hit.v === G.dataV) return hit.s;
  let topics = 0, posts = 0;
  for (const n of G.nodes) if (n.kind === "note" && n.grp === g) { if (n.tp && n.tp.startsWith("cat:")) topics++; posts += (n.posts || []).length; }
  const out = `${topics} TOPICS · ${posts} POSTS`; GSTATS.set(g, { v: G.dataV, s: out }); return out;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function drawOrbit(ctx, n, t, a) {
  const rings = n.kind === "core" ? [[0, 2.15, 1], [1.05, 1.75, -1.4]] : n.kind === "lens" ? [[0.5, 1.9, 2]] : [[0.35, 1.85, 0.8]];
  const R0 = dR(n);
  for (const [tilt, mul, speed] of rings) {
    const R = R0 * mul, ct = Math.cos(tilt), stt = Math.sin(tilt);
    const off = reduceMotion ? 0 : (t / 1000) * speed * 0.5;
    ctx.lineWidth = n.kind === "core" ? 1.3 : 1;
    for (let seg = 0; seg < 2; seg++) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const ang = off + seg * Math.PI + (i / 40) * Math.PI * 0.82;
        const lx = Math.cos(ang) * R, lz = Math.sin(ang) * R;
        const wy = -lz * stt, wz = lz * ct;
        const p = G.dim === 3 ? projT(n.x + lx, n.y + wy, n.z + wz) : proj(n.x + lx, n.y + lz * 0.45 + wy * 0.3, 0);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = rgba(n.color, 0.55 * a * (seg ? 0.55 : 1));
      ctx.stroke();
    }
  }
}
// control point for a tree link: leave the parent along its outward direction (away from the grandparent),
// so siblings share a bundle and then fan out to their children
function treeCtrl(l) {
  const a = l.s._p, b = l.t._p, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const gp = l.s.tp ? G.byId.get(l.s.tp) : null;
  if (!gp || !gp._p) return { x: mx, y: my };
  let dx = a.x - gp._p.x, dy = a.y - gp._p.y; const dl = Math.hypot(dx, dy);
  if (dl < 1) return { x: mx, y: my };
  dx /= dl; dy /= dl;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ox = a.x + dx * len * 0.55, oy = a.y + dy * len * 0.55;
  return { x: mx + (ox - mx) * 0.5, y: my + (oy - my) * 0.5 };
}
// pulse: a white 2px head with a cached cyan halo and a 14px trail runs core-outward along lit paths;
// each node flashes a 1px ring as the head arrives
const WAVE_EDGE = 300;
function drawWave(ctx, ph, s0, only) {
  const lit = only ? new Set([...G.lit].filter((id) => only.has(id))) : G.lit, halo = haloSprite();
  const heads = [];
  const edge = (a, b, dChild, cpt) => {
    const u = (ph - (dChild - 1) * WAVE_STEP) / WAVE_EDGE;
    if (u < 0 || u > 1.15) return;
    const pa = a._p, pb = b._p, cp = cpt || { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const at = (v) => { const m = 1 - v; return { x: m * m * pa.x + 2 * m * v * cp.x + v * v * pb.x, y: m * m * pa.y + 2 * m * v * cp.y + v * v * pb.y }; };
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const uu = clamp(u, 0, 1), fadeOut = u > 1 ? 1 - (u - 1) / 0.15 : 1;
    const H = at(uu), Tt = at(Math.max(0, uu - 14 / len));
    const hx = H.x, hy = H.y, tx = Tt.x, ty = Tt.y;
    const gr = ctx.createLinearGradient(tx, ty, hx, hy);
    gr.addColorStop(0, "rgba(56,225,255,0)"); gr.addColorStop(1, `rgba(170,244,255,${0.8 * fadeOut})`);
    ctx.strokeStyle = gr; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    heads.push([hx, hy, fadeOut]);
  };
  for (const l of G.tree) if (lit.has(l.t.id) && lit.has(l.s.id)) edge(l.s, l.t, l.t.depth, l._cp);
  if (G.litPosts) for (const id of G.litPosts) { if (only && !only.has(id)) continue; const p = G.postById.get(id); const par = p && G.byId.get(p.parentId); if (p && par) edge(par, p, p.depth); }
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, f] of heads) { ctx.globalAlpha = f; ctx.drawImage(halo, x - 6, y - 6, 12, 12); }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#ffffff";
  for (const [x, y, f] of heads) { ctx.globalAlpha = f; ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill(); }
  // flash rings as the head arrives
  ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 1;
  for (const id of lit) {
    const n = nodeData(id); if (!n || !n._p) continue;
    const f = ph - ((n.depth || 0) - 1) * WAVE_STEP - WAVE_EDGE;
    if (n.kind === "core" ? ph > 450 : (f < 0 || f > 450)) continue;
    const k = n.kind === "core" ? ph / 450 : f / 450, p = n._p, d = 2 * dR(n) * p.s;
    ctx.globalAlpha = 0.9 * (1 - k);
    ctx.beginPath(); ctx.arc(p.x, p.y, d / 2 + 3 + k * 0.35 * d, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// label widths are measured once per font/text and reused; placed boxes go in a coarse grid so the overlap test
// only looks at nearby labels instead of every one placed so far
const LABW = new Map();
function placeLabels(ctx, labels, layer = "all") {
  labels.sort((a, b) => b.prio - a.prio);
  const CELL = 96, grid = new Map();
  const LS = "letterSpacing" in ctx;
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
  // labels that lose (or win) their spot fade out (or in) over ~150 ms instead of flickering
  const now = performance.now(), dt = Math.min(100, now - (G.labT[layer] || now)); G.labT[layer] = now;
  const k = 1 - Math.exp(-dt / 70);
  let anim = false, curFont = "", curTrk = null;
  if (LABW.size > 6000) LABW.clear();
  const seen = new Set();
  const setFont = (f, t) => { if (f !== curFont) { ctx.font = f; curFont = f; } if (LS && t !== curTrk) { ctx.letterSpacing = t + "px"; curTrk = t; } };
  for (const L of labels) {
    const trk = L.trk || 0, wk = L.font + "|" + trk + "|" + L.txt;
    let w = LABW.get(wk);
    if (w == null) { setFont(L.font, trk); w = ctx.measureText(L.txt).width; LABW.set(wk, w); }
    const pad = L.prio >= 90 ? 6 : 4;
    const x0 = L.x - w / 2 - pad, x1 = L.x + w / 2 + pad;
    const y0 = L.y - 2, y1 = L.y + L.h + (L.sub ? L.h * 0.7 : 0) + 1;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    let fits = true;
    if (L.prio < 112) {
      outer: for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const b = grid.get(cx * 100003 + cy); if (!b) continue;
        for (const r of b) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { fits = false; break outer; }
      }
    }
    const key = layer + L.id; seen.add(key);
    const prev = G.labA.has(key) ? G.labA.get(key) : 0;
    const tgt = fits ? 1 : 0, cur = reduceMotion ? tgt : prev + (tgt - prev) * k;
    if (Math.abs(cur - tgt) > 0.02) anim = true;
    G.labA.set(key, cur);
    if (fits) { const r = [x0, y0, x1, y1]; for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) { const kk = cx * 100003 + cy; let b = grid.get(kk); if (!b) grid.set(kk, (b = [])); b.push(r); } }
    if (cur < 0.03) continue;
    setFont(L.font, trk);
    ctx.globalAlpha = L.alpha * cur;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(4,7,13,.85)"; ctx.strokeText(L.txt, L.x, L.y);
    ctx.fillStyle = L.fill; ctx.fillText(L.txt, L.x, L.y);
    if (L.sub) {
      setFont(L.subFont, 0.6); ctx.fillStyle = "#8fa4b9";
      ctx.strokeText(L.sub, L.x, L.y + L.h + 2); ctx.fillText(L.sub, L.x, L.y + L.h + 2);
    }
  }
  if (LS) ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
  for (const key of G.labA.keys()) if (key.startsWith(layer) && !seen.has(key)) G.labA.delete(key);
  G.labAnim = anim;
}
const interp = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, b] = [pts[i - 1], pts[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return pts[pts.length - 1][1]; };
const LABEL_NAMES = ["Main topics", "+ Categories", "+ Key topics", "+ All topics", "Everything"];
function syncLabelUi() {
  const r = $("#o-lablvl"), a = $("#o-labauto"), nm = $("#o-labname"); if (!r) return;
  const L = G.labelAuto ? G.autoLvl : G.labelLvl;
  r.value = String(L); r.classList.toggle("auto", G.labelAuto);
  r.setAttribute("aria-valuetext", LABEL_NAMES[L]);
  a.setAttribute("aria-pressed", String(G.labelAuto));
  nm.textContent = (G.labelAuto ? "Auto · " : "") + LABEL_NAMES[L];
}
const varCache = new Map();
function getVar(v) { if (!varCache.has(v)) varCache.set(v, getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "sans-serif"); return varCache.get(v); }
function drawBrackets(ctx, x, y, r, d) {
  const L = clamp(d * 0.16, 4, 12);
  ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * r, y + sy * (r - L)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - L), y + sy * r);
  }
  ctx.stroke();
}
function drawGrid(ctx) {
  const W = G.W, H = G.H;
  ctx.lineWidth = 1;
  if (G.dim === 2) {
    const step = 80 * G.cam.k;
    if (step < 18) return;
    const ox = (G.cam.tx + W / 2) % step, oy = (G.cam.ty + H / 2) % step;
    ctx.strokeStyle = "rgba(33,59,80,.12)";
    ctx.beginPath();
    for (let x = ox; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    return;
  }
  const fy = G.floorY, ext = 3200, step = 160;
  for (let v = -ext; v <= ext; v += step) {
    for (const [a, b] of [[[v, fy, -ext], [v, fy, ext]], [[-ext, fy, v], [ext, fy, v]]]) {
      const p = proj(...a), q = proj(...b);
      if (p.s <= 0 || q.s <= 0) continue;
      const fade = clamp((p.s + q.s) / 2 / ((FOCAL / DIST) * G.cam.k), 0.15, 1.3) * (1 - Math.abs(v) / ext * 0.7);
      ctx.strokeStyle = `rgba(33,59,80,${Math.min(0.2, 0.12 * fade)})`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }
  for (const [R, al] of [[520, 0.22], [980, 0.14]]) {
    ctx.strokeStyle = `rgba(33,59,80,${al})`;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const p = proj(Math.cos(a) * R, fy, Math.sin(a) * R);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
}

/* ---------- hit testing ---------- */
function hitTest(x, y) {
  let best = null, bd = Infinity;
  for (const n of G.nodes.concat(G.posts)) {
    const p = n._p; if (!p || (n._c || 0) > 0.5) continue;
    if (G.pulled && !inPulledGroup(n.id)) continue;   // focus mode: background is not clickable
    if (n._hid || n._tl || (n._p && n._p.near != null && n._p.near < 0.3)) continue;
    const lens = n.kind === "lens";
    const r = Math.max(lens ? 18 : 0, n._hr || Math.max(9, n.r * p.s + 5));
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= r) { const score = d / r - (G.dim === 3 ? p.s * 0.02 : 0) + (n.kind === "post" ? 0.15 : 0) - (lens ? 0.5 : 0); if (score < bd) { bd = score; best = n; } }
  }
  return best;
}

/* ---------- pointer + wheel ---------- */
function localXY(e) { const r = G.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function onDown(e) {
  try { G.cv.setPointerCapture(e.pointerId); } catch (_) {}
  const pt = localXY(e);
  G.pointers.set(e.pointerId, pt);
  hideHover();
  if (G.pointers.size === 2) {
    const [a, b] = [...G.pointers.values()];
    // two fingers = middle mouse: drag to move through the space, spread or pinch to zoom
    G.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: G.cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    clearTimeout(G.tapTimer); G.taps = null;
    if (G.drag && G.drag.node && !G.drag.wasPinned) G.drag.node.pin = false;
    if (G.drag) releaseBand(G.drag);
    G.drag = null; return;
  }
  if (e.button === 1) { e.preventDefault(); G.drag = { node: null, hit: null, x0: pt.x, y0: pt.y, lx: pt.x, ly: pt.y, moved: false, hist: [], mode: "pan", middle: true }; G.cv.classList.add("grabbing"); kick(); return; }
  if (e.button === 2) { e.preventDefault(); G.drag = { node: null, hit: hitTest(pt.x, pt.y), x0: pt.x, y0: pt.y, lx: pt.x, ly: pt.y, moved: false, hist: [], mode: "pan", middle: true, right: true }; G.cv.classList.add("grabbing"); kick(); return; }
  const n = hitTest(pt.x, pt.y);
  const draggable = n && n.kind !== "core";
  const offer = G.pinOffer && n && G.pinOffer.id === n.id ? G.pinOffer : null;
  if (G.pinOffer && !offer) dropPinOffer();
  if (offer) { clearTimeout(G.pinTimer); G.pinOffer = null; }
  const home = offer ? offer.home : n && n.userPin ? n.userPin.home : n ? { x: n.x, y: n.y, z: n.z } : null;
  G.drag = { node: draggable ? n : null, hit: n, x0: pt.x, y0: pt.y, lx: pt.x, ly: pt.y, moved: false, hist: [], shook: false, wasPinned: n ? !!n.pin && !offer : false, home, n0: n ? { x: n.x, y: n.y, z: n.z } : null, mode: draggable ? "node" : G.dim === 3 && !e.shiftKey ? "rotate" : "pan" };
  G.cv.classList.add("grabbing");
  kick();
}
function onMove(e) {
  const pt = localXY(e);
  G.mouse = pt;
  if (G.pointers.has(e.pointerId)) G.pointers.set(e.pointerId, pt);
  if (G.pinch && G.pointers.size === 2) {
    const [a, b] = [...G.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    G.cam.tx += mx - G.pinch.mx; G.cam.ty += my - G.pinch.my;
    G.pinch.mx = mx; G.pinch.my = my;
    zoomBy(clamp(G.pinch.k * d / G.pinch.d, 0.06, 8) / G.cam.k, mx, my);
    G.camAnim = null; kick();
    return;
  }
  const D = G.drag;
  if (!D) {
    const n = hitTest(pt.x, pt.y);
    const id = n ? n.id : null;
    if (id !== G.hover) { G.hover = id; G.cv.classList.toggle("over", !!n); scheduleHover(id); kick(); }
    else if (id) placeHover();
    return;
  }
  const dx = pt.x - D.lx, dy = pt.y - D.ly;
  D.lx = pt.x; D.ly = pt.y;
  if (!D.moved && Math.hypot(pt.x - D.x0, pt.y - D.y0) > 5) D.moved = true;
  if (!D.moved) return;
  if (D.mode === "node" && D.node) {
    const n = D.node;
    if (n.kind === "post") n.free = true;
    n.pin = true;
    let w;
    if (G.dim === 2) w = { x: dx / G.cam.k, y: dy / G.cam.k, z: 0 };
    else { const p = projT(n.x, n.y, n.z); w = untree(unrot(dx / p.s, dy / p.s, 0)); }
    n.x += w.x; n.y += w.y; n.z += w.z;
    if (n.kind === "lens") n.userPlaced = true;
    const P = G.pulled;
    if (P && (P.root === n.id || P.members.includes(n.id))) {
      const sub = P.root === n.id ? null : new Set(branchOf(n.id).map((b) => b.n.id).filter((x) => P.members.includes(x)));
      const carry = P.root === n.id ? [...P.members.map((x) => G.byId.get(x)), ...P.posts.map((x) => G.postById.get(x))]
        : [...[...sub].map((x) => G.byId.get(x)), ...P.posts.map((x) => G.postById.get(x)).filter((p) => p && (p.pullOwner === n.id || sub.has(p.pullOwner)))];
      for (const c of carry) { if (!c) continue; G.anims = G.anims.filter((a) => a.n !== c); c.x += w.x; c.y += w.y; c.z += w.z; }
    }
    if (n.kind !== "post" && n.kind !== "lens" && !(P && inPulledGroup(n.id)) && !D.band) startBand(D, n);
    if (n.kind !== "post") G.alpha = Math.max(G.alpha, 0.12);
    const now = performance.now();
    D.hist.push({ t: now, x: pt.x, y: pt.y });
    D.hist = D.hist.filter((hh) => now - hh.t < 900);
    if (!D.shook && n.kind !== "post" && detectShake(D.hist)) {
      D.shook = true;
      releaseBand(D);
      G.pulses.push({ id: n.id, t0: performance.now() });
      togglePull(n.id);
      G.drag = null; G.cv.classList.remove("grabbing");
    }
  } else if (D.mode === "rotate") {
    G.cam.yaw += dx * 0.006; G.cam.pitch = clamp(G.cam.pitch + dy * 0.006, -1.45, 1.45);
  } else { G.cam.tx += dx; G.cam.ty += dy; }
  kick();
}
function detectShake(hist) {
  if (hist.length < 6) return false;
  let rev = 0, dir = 0, travel = 0;
  for (let i = 1; i < hist.length; i++) {
    const dx = hist[i].x - hist[i - 1].x, dy = hist[i].y - hist[i - 1].y;
    const mv = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    if (Math.abs(mv) < 1.5) continue;
    const s = Math.sign(mv);
    if (dir && s !== dir) { if (travel >= 16) rev++; travel = 0; }
    dir = s; travel += Math.abs(mv);
  }
  return rev >= 4;
}
function onUp(e) {
  G.pointers.delete(e.pointerId);
  if (G.pointers.size < 2) G.pinch = null;
  const D = G.drag;
  G.drag = null; G.cv.classList.remove("grabbing");
  if (!D) return;
  if (D.right) {
    // right-click on a node opens or closes its branch (the same as shaking it); posts open their preview
    const n = D.hit;
    if (n && !D.moved && e.type === "pointerup") { if (n.kind === "post") showPreview(n.id); else { pulse(n.id); togglePull(n.id); } }
    updateStatus(); kick(); return;
  }
  const n = D.node || D.hit;
  if (n && !D.moved) {
    if (n.kind === "note") select(n.id); else showPreview(n.id);
  } else if (D.mode === "node" && D.node && D.moved) {
    const m = D.node;
    if (m.kind === "post") { if (!inPulledGroup(m.id)) returnPost(m); }
    else if (!inPulledGroup(m.id) && m.kind !== "lens") { const branch = D.band ? D.band.filter((e) => e.desc) : []; releaseBand(D, true); offerPin(m, D, branch); }
  } else if (!D.moved && !D.middle) {
    if (e.pointerType === "touch") emptyTap(localXY(e));
    else select(null);
  }
  updateStatus(); kick();
}
// touch: one tap on empty space closes the selection (after a short wait);
// three quick taps frame the selected node, or the whole network when nothing is selected (same as F)
function emptyTap(pt) {
  const now = performance.now(), T = G.taps;
  if (T && now - T.t < 420 && Math.hypot(pt.x - T.x, pt.y - T.y) < 60) { T.n++; T.t = now; T.x = pt.x; T.y = pt.y; }
  else G.taps = { n: 1, t: now, x: pt.x, y: pt.y };
  clearTimeout(G.tapTimer);
  if (G.taps.n >= 3) { G.taps = null; frameSelected(); return; }
  G.tapTimer = setTimeout(() => { G.taps = null; select(null); updateStatus(); kick(); }, 420);
}
function returnPost(p, delay = 0, dur = 500) {
  const to = () => { const par = G.byId.get(p.parentId) || p; return { x: par.x + p.ox, y: par.y + p.oy, z: par.z + p.oz }; };
  G.anims = G.anims.filter((a) => a.n !== p);
  G.anims.push({ n: p, from: { x: p.x, y: p.y, z: p.z }, to, t0: performance.now() + delay, dur: reduceMotion ? 1 : dur, ease: easeInOut, done: () => { p.free = false; p.pin = false; } });
  kick();
}
/* ---------- undo / redo: up to 50 steps back and forward ---------- */
const HX = { undo: [], redo: [], txn: null, replaying: false, label: null, MAX: 50 };
const hxClone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
function histLabel(l) { HX.label = l; }
function histPush(e) {
  if (HX.replaying) return;
  HX.undo.push(e); if (HX.undo.length > HX.MAX) HX.undo.shift();
  HX.redo = [];
  syncHistUi();
}
// note and category writes made close together (one action) are grouped into one step
function histRecordData(kind, id, prior, next) {
  if (HX.replaying) return;
  if (!HX.txn) {
    const nm = kind === "note" ? (next || prior || {}).title : null;
    const T = (HX.txn = { label: HX.label || (nm ? `Edit "${short(nm, 28)}"` : "Edit categories"), notes: new Map(), meta: null });
    histPush({ label: T.label, undo: () => applyDataStep(T, "prior"), redo: () => applyDataStep(T, "next") });
    setTimeout(() => { if (HX.txn === T) { HX.txn = null; HX.label = null; } }, 600);
  }
  const T = HX.txn;
  if (kind === "note") { const r = T.notes.get(id); if (r) r.next = next; else T.notes.set(id, { prior, next }); }
  else if (!T.meta) T.meta = { prior, next }; else T.meta.next = next;
}
function applyDataStep(T, which) {
  if (T.meta && T.meta[which]) putMeta(hxClone(T.meta[which]));
  for (const [id, r] of T.notes) {
    const v = r[which];
    if (v) putNote(hxClone(v)); else if (st.notes.has(id)) removeNote(id);
  }
}
function histGo(dir) {
  const from = dir < 0 ? HX.undo : HX.redo, to = dir < 0 ? HX.redo : HX.undo;
  const e = from.pop(); if (!e) return;
  HX.txn = null; HX.label = null;
  HX.replaying = true;
  try { (dir < 0 ? e.undo : e.redo)(); } catch (err) { console.warn(err); } finally { HX.replaying = false; }
  to.push(e); if (to.length > HX.MAX) to.shift();
  toast((dir < 0 ? "Undid: " : "Redid: ") + e.label);
  syncHistUi(); kick();
}
function syncHistUi() {
  const u = $("#b-undo"), r = $("#b-redo"); if (!u) return;
  const lu = HX.undo[HX.undo.length - 1], lr = HX.redo[HX.redo.length - 1];
  u.disabled = !lu; r.disabled = !lr;
  u.title = lu ? `Undo: ${lu.label} (Ctrl+Z) · ${HX.undo.length} step${HX.undo.length > 1 ? "s" : ""}` : "Nothing to undo";
  r.title = lr ? `Redo: ${lr.label} (Ctrl+Shift+Z) · ${HX.redo.length} step${HX.redo.length > 1 ? "s" : ""}` : "Nothing to redo";
}
// node positions + pins, for undoing pins and moves of pinned branches
function snapNodes(ids) { return ids.map((id) => { const n = G.byId.get(id); return n && { id, x: n.x, y: n.y, z: n.z, userPin: n.userPin ? hxClone(n.userPin) : null }; }).filter(Boolean); }
function applySnap(S) {
  const now = performance.now();
  for (const r of S) {
    const n = G.byId.get(r.id); if (!n) continue;
    G.anims = G.anims.filter((a) => a.n !== n);
    if (r.userPin) n.userPin = hxClone(r.userPin); else delete n.userPin;
    n.pin = true;
    G.anims.push({ n, from: { x: n.x, y: n.y, z: n.z }, to: { x: r.x, y: r.y, z: r.z }, t0: now, dur: reduceMotion ? 1 : 600, ease: easeInOut,
      done: () => { n.pin = !!n.userPin || G.arrange !== "free" || n.kind === "core" || n.kind === "lens"; if (!n.pin) G.alpha = Math.max(G.alpha, 0.15); } });
  }
  G.pinOffer = null; clearTimeout(G.pinTimer); hidePinChip();
  setTimeout(savePins, reduceMotion ? 0 : 650);
  refreshPreview(); kick();
}
/* ---------- rubber band: nodes linked to the one you drag trail behind it on springs ---------- */
// the whole branch under a node, nearest first, with each node's depth below it
function branchOf(id) {
  const kids = new Map();
  for (const m of G.nodes) if (m.tp) { if (!kids.has(m.tp)) kids.set(m.tp, []); kids.get(m.tp).push(m); }
  const out = [], q = [[id, 0]], seen = new Set([id]);
  while (q.length) { const [x, d] = q.shift(); for (const k of kids.get(x) || []) if (!seen.has(k.id)) { seen.add(k.id); out.push({ n: k, d: d + 1 }); q.push([k.id, d + 1]); } }
  return out;
}
function startBand(D, n) {
  const ok = (m) => m && m.kind !== "core" && m.kind !== "lens" && !m._tl && !inPulledGroup(m.id);
  // everything under the dragged node follows it (deeper levels trail a little more, like a rubber band);
  // pieces pinned on their own stay where they are, pieces pinned along with this node move with it
  const sameGroup = (m) => m.userPin && (m.userPin.by === n.id || (n.userPin && n.userPin.by && m.userPin.by === n.userPin.by));
  const branch = branchOf(n.id).filter((b) => ok(b.n) && (!b.n.userPin || sameGroup(b.n)));
  const inBranch = new Set(branch.map((b) => b.n.id));
  const desc = branch.map(({ n: m, d }) => {
    const rigid = sameGroup(m);
    return { n: m, s: { x: m.x, y: m.y, z: m.z }, pin0: !!m.pin, desc: true, d, w: rigid ? 1 : Math.max(0.55, 0.92 - 0.09 * (d - 1)), k: rigid ? 0.45 : Math.max(0.09, 0.24 - 0.05 * (d - 1)) };
  });
  // nodes linked sideways (and the parent) are tugged a little
  const side = [...(G.adj.get(n.id) || [])].map((id) => G.byId.get(id)).filter((m) => ok(m) && !m.userPin && !inBranch.has(m.id))
    .map((m) => ({ n: m, s: { x: m.x, y: m.y, z: m.z }, pin0: !!m.pin, desc: false, w: m.id === n.tp ? 0.26 : 0.34, k: 0.18 }));
  D.band = desc.concat(side);
  for (const e of D.band) { G.anims = G.anims.filter((a) => a.n !== e.n); e.n.pin = true; }
}
function bandStep() {
  const D = G.drag; if (!D || !D.band || !D.band.length || !D.node) return false;
  const n = D.node, dx = n.x - D.n0.x, dy = n.y - D.n0.y, dz = n.z - D.n0.z;
  for (const e of D.band) { const m = e.n, k = e.k || 0.2; m.x += (e.s.x + dx * e.w - m.x) * k; m.y += (e.s.y + dy * e.w - m.y) * k; m.z += (e.s.z + dz * e.w - m.z) * k; }
  return true;
}
// after a drop the branch keeps easing into place for a moment while the Pin option is up
function holdStep() {
  const O = G.pinOffer; if (!O || !O.band || !O.band.length) return false;
  const n = G.byId.get(O.id); if (!n) return false;
  const dx = n.x - O.n0.x, dy = n.y - O.n0.y, dz = n.z - O.n0.z;
  let moving = false;
  for (const e of O.band) {
    const m = e.n, k = e.k || 0.2, tx = e.s.x + dx * e.w, ty = e.s.y + dy * e.w, tz = e.s.z + dz * e.w;
    if (Math.abs(tx - m.x) + Math.abs(ty - m.y) + Math.abs(tz - m.z) > 0.3) moving = true;
    m.x += (tx - m.x) * k; m.y += (ty - m.y) * k; m.z += (tz - m.z) * k;
  }
  return moving;
}
function releaseBand(D, keepBranch) {
  if (!D || !D.band) return;
  const now = performance.now(), T = G.arrange !== "free" ? G.arrT : null;
  for (const e of D.band) {
    if (keepBranch && e.desc) continue;
    const m = e.n, to = T && T.get(m.id);
    if (to && !m.userPin) { G.anims = G.anims.filter((a) => a.n !== m); G.anims.push({ n: m, from: { x: m.x, y: m.y, z: m.z }, to, t0: now, dur: reduceMotion ? 1 : 650, ease: easeOutBack, done: () => { m.pin = true; } }); }
    else m.pin = e.pin0;
  }
  D.band = null;
  G.alpha = Math.max(G.alpha, 0.25); kick();
}
/* ---------- pinning: after a drag the node waits a moment with a Pin option; pinned nodes stay put ---------- */
const pinKey = () => "pins:" + G.dim + ":" + G.arrange;
function savePins() { const o = {}; for (const n of G.nodes) if (n.userPin) o[n.id] = { x: n.x, y: n.y, z: n.z, home: n.userPin.home, ...(n.userPin.by ? { by: n.userPin.by } : {}) }; store.set(pinKey(), o); }
function applyPins() {
  const o = store.get(pinKey(), {}) || {};
  for (const n of G.nodes) {
    if (inPulledGroup(n.id)) continue;
    const r = o[n.id];
    if (r) { G.anims = G.anims.filter((a) => a.n !== n); n.x = r.x; n.y = r.y; n.z = r.z; n.pin = true; n.userPin = { home: r.home || { x: r.x, y: r.y, z: r.z }, ...(r.by ? { by: r.by } : {}) }; n.vx = n.vy = n.vz = 0; }
    else if (n.userPin) { delete n.userPin; n.pin = G.arrange !== "free" || n.kind === "core" || n.kind === "lens"; }
  }
}
function offerPin(m, D, branch = []) {
  if (m.userPin) {
    // a pinned node moved: it and its whole branch are pinned at the new spot
    for (const e of branch) { const k = e.n; if (!k.userPin) k.userPin = { home: e.s, by: m.userPin.by || m.id }; k.pin = true; }
    G.pinOffer = { id: m.id, home: m.userPin.home, n0: D.n0, band: branch, pinned: true };
    const ids0 = [m.id, ...branch.map((e) => e.n.id)];
    const before = [{ id: m.id, ...D.n0, userPin: hxClone(m.userPin) }, ...branch.map((e) => ({ id: e.n.id, ...e.s, userPin: hxClone(e.n.userPin) }))];
    setTimeout(() => {
      if (G.pinOffer && G.pinOffer.pinned && G.pinOffer.id === m.id) { G.pinOffer = null; savePins(); }
      const after = snapNodes(ids0);
      histPush({ label: `Move pinned "${short(m.title || "", 24)}"`, undo: () => applySnap(before), redo: () => applySnap(after) });
    }, 900);
    savePins(); showPinChip(m.id, 2600); return;
  }
  m.pin = true; m.vx = m.vy = m.vz = 0;
  G.pinOffer = { id: m.id, home: D.home || D.n0, n0: D.n0, band: branch };
  clearTimeout(G.pinTimer); G.pinTimer = setTimeout(dropPinOffer, 4200);
  showPinChip(m.id);
}
function dropPinOffer() {
  const O = G.pinOffer; G.pinOffer = null; clearTimeout(G.pinTimer);
  hidePinChip();
  const m = O && G.byId.get(O.id); if (!m || m.userPin) { if (O && O.pinned) savePins(); return; }
  springHome(m, O.home);
  for (const e of O.band || []) if (!e.n.userPin) springHome(e.n, e.s);   // the branch springs back with it
}
function springHome(m, home) {
  const to = (G.arrange !== "free" && G.arrT && G.arrT.get(m.id)) || home;
  if (G.arrange === "free") {
    // free layout: spring most of the way home, then let the physics settle it among its links
    G.anims = G.anims.filter((a) => a.n !== m);
    if (to) G.anims.push({ n: m, from: { x: m.x, y: m.y, z: m.z }, to, t0: performance.now(), dur: reduceMotion ? 1 : 750, ease: easeOutBack, done: () => { m.pin = false; G.alpha = Math.max(G.alpha, 0.2); kick(); } });
    else { m.pin = false; G.alpha = Math.max(G.alpha, 0.2); }
  } else if (to) {
    G.anims = G.anims.filter((a) => a.n !== m);
    G.anims.push({ n: m, from: { x: m.x, y: m.y, z: m.z }, to, t0: performance.now(), dur: reduceMotion ? 1 : 750, ease: easeOutBack, done: () => { m.pin = true; } });
  }
  kick();
}
function pinNode(id) {
  const m = G.byId.get(id); if (!m || m.kind === "core") return;
  const O = G.pinOffer && G.pinOffer.id === id ? G.pinOffer : null;
  // before: where the branch was before the drag (or right now, when pinned from the card)
  const ids0 = [id, ...branchOf(id).map((b) => b.n.id)];
  const heldS = new Map((O && O.band ? O.band : []).map((e) => [e.n.id, e.s]));
  const before = snapNodes(ids0).map((r) => (r.id === id && O ? { ...r, ...O.home, userPin: null } : heldS.has(r.id) ? { ...r, ...heldS.get(r.id), userPin: r.userPin && r.userPin.by !== id ? r.userPin : null } : r));
  G.pinOffer = null; clearTimeout(G.pinTimer);
  G.anims = G.anims.filter((a) => a.n !== m);
  const homeOf = (n) => (G.arrange !== "free" && G.arrT && G.arrT.get(n.id)) || { x: n.x, y: n.y, z: n.z };
  m.userPin = { home: O ? O.home : homeOf(m) };
  m.pin = true; m.vx = m.vy = m.vz = 0;
  // everything under it is pinned with it (pieces you pinned on their own keep their own pin)
  const held = new Map((O && O.band ? O.band : []).map((e) => [e.n.id, e.s]));
  let count = 0;
  for (const { n: k } of branchOf(id)) {
    if (k.kind === "core" || k.kind === "lens" || inPulledGroup(k.id) || (k.userPin && k.userPin.by !== id)) continue;
    G.anims = G.anims.filter((a) => a.n !== k);
    k.userPin = { home: held.get(k.id) || (k.userPin && k.userPin.home) || homeOf(k), by: id };
    k.pin = true; k.vx = k.vy = k.vz = 0; count++;
  }
  savePins(); pulse(id);
  const after = snapNodes(ids0);
  histPush({ label: `Pin "${short(m.title || "", 28)}"`, undo: () => applySnap(before), redo: () => applySnap(after) });
  if (count) toast(`Pinned "${short(m.title || "", 30)}" and the ${count} node${count > 1 ? "s" : ""} under it`);
  showPinChip(id, 2200); refreshPreview(); kick();
}
function unpinNode(id) {
  const m = G.byId.get(id); if (!m || !m.userPin) return;
  const root = m.userPin.by ? G.byId.get(m.userPin.by) || m : m;
  // unpinning releases the whole branch that was pinned with it; each piece springs back to where it started
  const group = [root, ...G.nodes.filter((k) => k.userPin && k.userPin.by === root.id)];
  const before = snapNodes(group.map((k) => k.id));
  const after = group.map((k) => { const home = (G.arrange !== "free" && G.arrT && G.arrT.get(k.id)) || (k.userPin && k.userPin.home) || k; return { id: k.id, x: home.x, y: home.y, z: home.z, userPin: null }; });
  for (const k of group) { const home = k.userPin && k.userPin.home; delete k.userPin; springHome(k, home); }
  savePins();
  histPush({ label: `Unpin "${short(root.title || "", 28)}"`, undo: () => applySnap(before), redo: () => applySnap(after) });
  hidePinChip(); refreshPreview(); pulse(id);
}
function showPinChip(id, autoHide) {
  let c = $("#pinchip");
  if (!c) { c = h("div", { class: "pinchip hud", id: "pinchip", hidden: "" }); G.wrap.append(c); }
  const m = G.byId.get(id); if (!m) return;
  c.dataset.id = id;
  clearTimeout(G.chipTimer);
  if (m.userPin) {
    const by = m.userPin.by && G.byId.get(m.userPin.by);
    c.replaceChildren(h("span", { class: "pc-k" }, by ? `📌 Pinned with ${short(by.title, 22)}` : "📌 Pinned"), h("button", { type: "button", class: "pc-b", title: "Spring back to where it started", onclick: () => unpinNode(id) }, "Unpin ↺"));
    c.classList.remove("offer");
  } else {
    c.replaceChildren(h("button", { type: "button", class: "pc-b pc-pin", title: "Keep it here (it stays linked to its branch)", onclick: () => pinNode(id) }, "📌 Pin here"),
      h("button", { type: "button", class: "pc-b pc-no", "aria-label": "Let it spring back", title: "Let it spring back", onclick: dropPinOffer }, "✕"), h("i", { class: "pc-timer" }));
    c.classList.remove("offer"); void c.offsetWidth; c.classList.add("offer");
  }
  c.hidden = false; placePinChip();
  if (autoHide) G.chipTimer = setTimeout(hidePinChip, autoHide);
}
function hidePinChip() { const c = $("#pinchip"); if (c) c.hidden = true; }
function placePinChip() {
  const c = $("#pinchip"); if (!c || c.hidden) return;
  const m = G.byId.get(c.dataset.id);
  if (!m || !m._p || m._tl) { c.hidden = true; return; }
  const w = c.offsetWidth || 120, hh = c.offsetHeight || 26, rr = m._hr || 12;
  // beside the node (labels sit underneath), flipping to the other side near the edge
  let x = m._p.x + rr + 16; if (x + w > G.W - 6) x = m._p.x - rr - 16 - w;
  c.style.transform = `translate(${Math.round(clamp(x, 4, G.W - w - 4))}px,${Math.round(clamp(m._p.y - hh / 2 - rr * 0.6, 4, G.H - hh - 4))}px)`;
}
function drawPin(ctx, x, y, solid, a) {
  ctx.globalAlpha = Math.max(0.6, a);
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y - 5); ctx.stroke();
  ctx.fillStyle = solid ? "#ff5c8a" : "rgba(255,255,255,.25)";
  ctx.beginPath(); ctx.arc(x + 6.5, y - 6.5, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.globalAlpha = a;
}
/* ---------- hide / unhide with the eye (separate from the timeline filter) ---------- */
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';
function eyeIcon(off) { const s = h("span", { class: "eye-i" }); s.innerHTML = off ? EYE_OFF : EYE; return s; }
function nodeLabel(id) {
  const n = nodeData(id); if (n) return (n.kind === "post" ? (n.name || (n.handle ? "@" + n.handle : n.title)) : n.title || n.name || id).replace(/^✦ /, "");
  const m = st.notes.get(id); return m ? m.title : id;
}
function setHidden(id, hide) {
  if (!id || id === "core" || id === "lens") return;
  if (G.userHidden.has(id) === !!hide) return;
  if (hide) G.userHidden.add(id); else G.userHidden.delete(id);
  histPush({ label: `${hide ? "Hide" : "Show"} "${short(nodeLabel(id), 28)}"`, undo: () => setHidden(id, !hide), redo: () => setHidden(id, hide) });
  store.set("hiddenNodes", [...G.userHidden]);
  if (hide && G.selected === id) hidePreview();
  if (hide && G.pulled && G.pulled.root === id) releasePull();
  tlApply(); refreshPreview();
  if (typeof renderFlow === "function" && st.view === "flow") renderFlow();
  toast(hide ? `Hid "${short(nodeLabel(id), 36)}"${nodeData(id) && nodeData(id).kind !== "post" ? " and what's under it" : ""}. Unhide it from 👁 Hidden in View options.` : `Showing "${short(nodeLabel(id), 36)}" again`);
}
function eyeBtn(id) {
  if (!id || id === "core" || id === "lens") return null;
  const b = h("button", { type: "button", class: "pv-eye", title: "Hide this node", "aria-label": "Hide " + nodeLabel(id), onclick: () => setHidden(id, true) });
  b.append(eyeIcon(false)); return b;
}
function syncHiddenUi() {
  const b = $("#o-hidden"); if (!b) return;
  const n = G.userHidden.size;
  b.hidden = !n;
  if (b._n !== n) { b._n = n; b.replaceChildren(eyeIcon(true), ` ${n} hidden`); }
  const pop = $("#hidden-pop"); if (pop && !pop.hidden) renderHiddenPop();
}
function renderHiddenPop() {
  let pop = $("#hidden-pop");
  if (!pop) { pop = h("div", { class: "hidden-pop hud", id: "hidden-pop", hidden: "" }); G.wrap.append(pop); }
  const ids = [...G.userHidden];
  if (!ids.length) { pop.hidden = true; return; }
  pop.replaceChildren(
    h("div", { class: "hp-head" }, h("span", { class: "mono-lbl" }, "Hidden nodes"), h("button", { type: "button", class: "btn small ghost", onclick: () => { const prev = [...G.userHidden]; const setAll = (ids) => { G.userHidden = new Set(ids); store.set("hiddenNodes", ids); tlApply(); if (st.view === "flow") renderFlow(); }; setAll([]); pop.hidden = true; histPush({ label: "Show all hidden", undo: () => setAll(prev), redo: () => setAll([]) }); toast("Showing everything again"); } }, "Show all"),
      h("button", { type: "button", class: "hp-x", "aria-label": "Close", onclick: () => { pop.hidden = true; } }, "✕")),
    h("ul", null, ids.map((id) => {
      const n = nodeData(id), col = n ? n.color : "#7d90a8";
      const b = h("button", { type: "button", class: "hp-eye", title: "Show it again", "aria-label": "Show " + nodeLabel(id), onclick: () => setHidden(id, false) });
      b.append(eyeIcon(true));
      return h("li", null, b, h("span", { class: "dot", style: `background:${col}` }), h("span", { class: "hp-t" }, short(nodeLabel(id), 44)), h("span", { class: "hp-k" }, n ? (n.kind === "note" ? "topic" : n.kind === "cat" ? "category" : n.kind === "group" ? "main topic" : n.kind === "realm" ? "branch" : n.kind) : ""));
    })));
  pop.hidden = false;
}
function inPulledGroup(id) {
  const P = G.pulled; if (!P) return false;
  if (!P.set || P.setN !== P.members.length + P.posts.length) { P.set = new Set([P.root, ...P.members, ...P.posts]); P.setN = P.members.length + P.posts.length; }
  return P.set.has(id);
}
function onWheel(e) {
  e.preventDefault();
  hideHover();
  const pt = localXY(e);
  zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), pt.x, pt.y);
}

/* ---------- hover card: thumbnail preview of the Instagram post or the topic ---------- */
function scheduleHover(id) {
  clearTimeout(G.hoverTimer);
  if (!id) { hideHover(); return; }
  G.hoverTimer = setTimeout(() => showHover(id), 90);
}
function hideHover() { clearTimeout(G.hoverTimer); const c = $("#hovercard"); if (c) c.hidden = true; }
function countPosts(n) {
  if (n.kind === "post") return 1;
  if (n.kind === "lens") return G.relate ? G.relate.posts.size : 0;
  let s = 0;
  for (const m of G.nodes) {
    if (m.kind !== "note") continue;
    const inside = n.kind === "core" || (n.kind === "realm" && REALM_SET.has(m.grp)) || (n.kind === "group" && m.grp === n.grp) || (n.kind === "cat" && m.ck === n.ck) || (n.kind === "note" && (m.id === n.id || m.tp === n.id));
    if (inside) s += (m.posts || []).length;
  }
  return s;
}
function descPosts(n, k) {
  let pool = [];
  if (n.kind === "post") pool = [n];
  else if (n.kind === "note") { pool = G.posts.filter((p) => p.parentId === n.id); if (!pool.length) for (const kid of st.children.get(n.id) || []) pool.push(...G.posts.filter((p) => p.parentId === kid)); }
  else if (n.kind === "lens") pool = [...(G.relate ? G.relate.posts : [])].map((id) => G.postById.get(id)).filter(Boolean);
  else if (n.kind === "cat") pool = G.posts.filter((p) => { const par = G.byId.get(p.parentId); return par && par.ck === n.ck; });
  else if (n.kind === "group") pool = G.posts.filter((p) => { const par = G.byId.get(p.parentId); return par && par.grp === n.grp; });
  else if (n.kind === "realm") pool = G.posts.filter((p) => { const par = G.byId.get(p.parentId); return par && REALM_SET.has(par.grp); });
  else pool = G.posts;
  pool = pool.filter((p) => thumbOf(p.code));
  if (pool.length <= k) return pool;
  const out = [], step = pool.length / k;
  for (let i = 0; i < k; i++) out.push(pool[Math.floor(i * step)]);
  return out;
}
function showHover(id) {
  const card = $("#hovercard");
  const n = nodeData(id);
  if (!card || !n || G.drag || st.view !== "graph") return;
  card.replaceChildren();
  card.style.setProperty("--cc", n.color || "#38e1ff");
  if (n.kind === "post") {
    const big = thumbEl(n.code, 258, "th big");
    card.append(big || (G.showThumbs ? h("div", { class: "th big none" }, "No preview") : ""),
      h("div", { class: "hc-body" },
        h("span", { class: "hc-k" }, "Instagram" + (n.handle ? " · @" + n.handle : "")),
        n.name ? h("span", { class: "hc-name" }, n.name) : null,
        h("b", null, short(n.title, 90)),
        tagChips(n.tags, true),
        n.tags && n.tags.a ? h("span", { class: "hc-x" }, n.tags.a) : null,
        h("span", { class: "hc-hint" }, "Click for the link")));
  } else {
    const ths = descPosts(n, n.kind === "note" && !n.hub ? 6 : 8);
    const kindLbl = n.kind === "core" ? "Core" : n.kind === "realm" ? "Branch" : n.kind === "group" ? "Group" : n.kind === "cat" ? "Category" : n.kind === "lens" ? "Related" : kindOf(st.notes.get(n.id) || {});
    const count = countPosts(n);
    card.append(
      h("div", { class: "hc-body" },
        h("span", { class: "hc-k" }, kindLbl + (count ? ` · ${count} posts` : "")),
        n.kind === "note" && n.name && n.name !== n.title ? h("span", { class: "hc-name" }, n.name) : null,
        h("b", null, short(n.kind === "note" ? n.title : n.full || n.title, 70)),
        n.kind === "note" && excerpt(st.notes.get(n.id) || {}, 120) ? h("span", { class: "hc-x" }, excerpt(st.notes.get(n.id), 120)) : null),
      ths.length ? h("div", { class: "mosaic" }, ths.map((p) => thumbEl(p.code, 60, "th"))) : null);
  }
  card.hidden = false;
  placeHover();
}
function placeHover() {
  const card = $("#hovercard");
  if (!card || card.hidden) return;
  const w = card.offsetWidth || 240, hh = card.offsetHeight || 200;
  let x = G.mouse.x + 18, y = G.mouse.y + 16;
  if (x + w > G.W - 8) x = G.mouse.x - w - 18;
  if (y + hh > G.H - 8) y = G.H - hh - 8;
  card.style.transform = `translate(${Math.round(Math.max(8, x))}px,${Math.round(Math.max(8, y))}px)`;
}

/* ---------- pull out / fly back ---------- */
function groupFor(root, depth = G.pullDepth) {
  const kidsOf = (id) => G.nodes.filter((n) => n.kind === "note" && n.tp === id);
  const descOf = (id) => { const out = []; const walk = (x) => { for (const k of kidsOf(x)) { out.push(k); walk(k.id); } }; walk(id); return out; };
  const postsOf = (ms, cap = 220) => { const ids = new Set(ms.map((m) => m.id)); return G.posts.filter((p) => ids.has(p.parentId)).slice(0, cap); };
  if (root.kind === "lens" && G.relate) {
    const members = G.relate.top.map((id) => G.byId.get(id)).filter((n) => n && n.kind === "note").slice(0, 30);
    let posts = depth >= 2 ? [...G.relate.posts].map((id) => G.postById.get(id)).filter(Boolean).sort((a, b) => (G.relate.pscore.get(b.id) || 0) - (G.relate.pscore.get(a.id) || 0)).slice(0, 160) : [];
    if (depth >= 3) { const have = new Set(posts.map((p) => p.id)); posts = posts.concat(postsOf(members, 400).filter((p) => !have.has(p.id))).slice(0, 260); }
    return members.length || posts.length ? { kind: "relate", members, posts } : null;
  }
  if (root.kind === "core") {
    const gs = G.nodes.filter((n) => n.kind === "group");
    return { kind: "groups", members: depth >= 2 ? gs.concat(G.nodes.filter((n) => n.kind === "cat")) : gs, posts: [] };
  }
  if (root.kind === "realm") {
    const gs = G.nodes.filter((n) => n.tp === root.id);
    return { kind: "groups", members: depth >= 2 ? gs.concat(G.nodes.filter((n) => n.kind === "cat" && REALM_SET.has(n.grp))) : gs, posts: [] };
  }
  if (root.kind === "group") {
    const cats = G.nodes.filter((n) => n.kind === "cat" && n.grp === root.grp);
    if (depth < 2) return { kind: "categories", members: cats, posts: [] };
    // cap what opens at once, and only bring the posts of topics that actually open (a post whose topic was
    // left out has nothing to hang from and floats loose)
    const notes = cats.flatMap((c) => (depth >= 3 ? descOf(c.id) : kidsOf(c.id))).slice(0, 160);
    return { kind: "categories and topics", members: cats.concat(notes), posts: depth >= 3 ? postsOf(notes, 400) : [] };
  }
  if (root.kind === "cat") {
    const ms = (depth >= 3 ? descOf(root.id) : kidsOf(root.id)).slice(0, 40);
    return { kind: "topics", members: ms, posts: depth >= 2 ? postsOf(ms) : [] };
  }
  const kids = depth >= 3 ? descOf(root.id) : kidsOf(root.id);
  if (kids.length) return { kind: "sub-topics", members: kids, posts: depth >= 2 ? postsOf(depth >= 3 ? kids.concat(root) : kids) : [] };
  const posts = G.posts.filter((p) => p.parentId === root.id);
  if (posts.length) return { kind: "sources", members: [], posts };
  const nb = [...(G.adj.get(root.id) || [])].map((id) => G.byId.get(id)).filter((n) => n && n.kind === "note" && n.id !== root.tp).slice(0, 30);
  if (!nb.length) return null;
  // a person's projects (or a project's people): sorted under their status / category, so the work reads as
  // In Progress · Not Started · On Hold · Done & Archived instead of one loose ring
  const cats = new Set(nb.map((n) => n.ck));
  if (cats.size < 2) return { kind: "linked nodes", members: nb.slice(0, 18), posts: [] };
  const extra = new Map();
  for (const n of nb) { let q = G.byId.get(n.tp); while (q && q.kind !== "group" && q.kind !== "realm" && q.kind !== "core" && q.id !== root.id) { if (!nb.includes(q)) extra.set(q.id, q); q = G.byId.get(q.tp); } }
  const work = nb.every((n) => n.grp === "Projects");
  return { kind: work ? "projects by status" : "linked nodes by category", members: [...extra.values(), ...nb], posts: [] };
}
function pullLabel(id) {
  const n = nodeData(id); if (!n || n.kind === "post") return null;
  if (G.pulled && G.pulled.root === id) return "Send back";
  const g = groupFor(n); if (!g) return null;
  if (g.kind === "relate") return `Gather ${g.members.length + g.posts.length} related`;
  return `Pull out ${g.members.length + g.posts.length} ${g.kind}`;
}
function ringSlots(count, minDim, first) {
  const slots = [];
  let r = count <= 12 ? clamp(95 + count * 11, 120, minDim * 0.36) : 110;
  let placed = 0, ring = 0;
  while (placed < count) {
    const gap = placed < first ? 62 : 46;
    const cap = count <= 12 ? count : Math.max(6, Math.floor((2 * Math.PI * r) / gap));
    const n = Math.min(cap, count - placed);
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + ring * 0.35; slots.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r }); }
    placed += n; ring++; r += placed <= first ? 64 : 50;
  }
  return slots;
}
function togglePull(id, relayout) {
  if (G.pulled && G.pulled.root === id && !relayout) { releasePull(); return; }
  // hopping from one focus to another remembers the way back
  if (!relayout && G.pulled && !G._back && nodeData(id)) G.focusHist = [...(G.focusHist || []), { root: G.pulled.root, depth: G.pullDepth }].slice(-20);
  if (!relayout) G.pullDepth = 2;
  const keepCam = G.pulled ? G.pulled.cam0 : null;
  const root = nodeData(id);
  if (!root || root.kind === "post") return;
  const g = groupFor(root);
  if (!g) { toast("This node has nothing to pull out yet"); return; }
  if (G.pulled) releasePull(true, true);
  hideHover();
  setRot();
  const cam0 = keepCam || { ...G.cam };
  const D3 = G.dim === 3;
  const toWorld = (px, py) => {
    if (!D3) return { x: (px - G.W / 2 - G.cam.tx) / G.cam.k, y: (py - G.H / 2 - G.cam.ty) / G.cam.k, z: 0 };
    const z2 = focusZ(), s = pScale(z2, G.cam.k);
    return untree(unrot((px - G.W / 2 - G.cam.tx) / s, (py - G.H / 2 - G.cam.ty) / s, z2));
  };
  const C = toWorld(G.W * 0.5, G.H * 0.52);
  const RV = D3 ? untree(unrot(1, 0, 0)) : { x: 1, y: 0, z: 0 }, DV = D3 ? untree(unrot(0, 1, 0)) : { x: 0, y: 1, z: 0 };
  const at = (dx, dy) => ({ x: C.x + RV.x * dx + DV.x * dy, y: C.y + RV.y * dx + DV.y * dy, z: C.z + RV.z * dx + DV.z * dy });
  // layout (world units, camera-facing plane): members on a ring, each member's posts fanned out around it as tiles
  const SP = 31;
  const memIds = new Set(g.members.map((m) => m.id));
  const own = new Map(g.members.map((m) => [m.id, []]));
  const loose = [];
  for (const p of g.posts) (memIds.has(p.parentId) ? own.get(p.parentId) : loose).push(p);
  const targets = [];
  const slotOf = new Map();
  const postTarget = new Map();
  let rootPos = C;
  const relArr = g.kind === "relate" ? G.arrange : null;
  for (const m of G.nodes) { m._route = m._rsrc = m._labCap = undefined; }
  let lensBus = 0;   // set when the search is laid out as pillars / grid
  if (relArr === "pillars" || relArr === "grid") {
    // the search follows the map's arrangement. Every matched topic is a "card": the topic, its label, and its posts
    // in a small grid under it. Cards are sized from their label and post count, so nothing can overlap.
    // Pillars: one column per main group (tall ones split side by side). Grid: equal cells, ordered by group.
    const gi0 = (m) => { const k = GROUP_ORDER.indexOf(m.grp); return k < 0 ? 99 : k; };
    // keep the search's own hierarchy: sub-topics follow their parent topic (and stay in its pillar)
    const inM = new Set(g.members.map((m) => m.id)), byM = new Map(g.members.map((m) => [m.id, m]));
    const parOf = (m) => (m.tp && m.tp !== m.id && inM.has(m.tp) ? m.tp : null);
    const kidsM = new Map();
    for (const m of g.members) { const q = parOf(m); if (q) { if (!kidsM.has(q)) kidsM.set(q, []); kidsM.get(q).push(m); } }
    const depthOf = new Map(), rootOf = new Map(), ms = [];
    const dfs = (m, d, r) => { if (depthOf.has(m.id)) return; depthOf.set(m.id, d); rootOf.set(m.id, r); ms.push(m); for (const k of kidsM.get(m.id) || []) dfs(k, d + 1, r); };
    for (const m of g.members.filter((m) => !parOf(m)).sort((a, b) => gi0(a) - gi0(b))) dfs(m, 0, m);
    for (const m of g.members) dfs(m, 0, m);   // (cycles: whatever is left starts its own branch)
    const gi = (m) => gi0(rootOf.get(m.id));
    // labels are drawn at a fixed screen size, so a card's width depends on the zoom the layout will be shown at:
    // lay out, work out the zoom that fits it on screen, and lay out again at that zoom (converges in a few passes)
    // (labels in a crowded layout are shortened so every column fits on screen side by side)
    let cap = 33;
    const labPx = (m) => Math.min(cap, String(m.title || "").length) * 7.4 + 16;
    const TOP = 230, GX_ = 46, GY = 34;
    lensBus = TOP * 0.5;
    const order = [...new Set(ms.map(gi))].sort((a, b) => a - b);
    const SW = Math.max(600, G.W - 90);
    // how many columns fit side by side on screen with their labels readable
    let cols = [], ncol = 1;
    const colsFor = (maxRows) => { const out = []; for (const k of order) { const b = ms.filter((m) => gi(m) === k); for (let c = 0; c < b.length; c += maxRows) out.push({ k, list: b.slice(c, c + maxRows), first: c === 0 }); } return out; };
    if (relArr !== "pillars") {
      const mx = Math.max(...ms.map(labPx)) + 30;
      ncol = Math.max(1, Math.min(ms.length, Math.floor(SW / mx), Math.ceil(Math.sqrt(ms.length * 1.6))));
    }
    let card, place, totW = 1, totH = 1, kz = 0.5;
    const layout = (k) => {
      totW = 1; totH = 1;
      card = new Map(ms.map((m) => {
        const n = own.get(m.id).length, w = Math.max(labPx(m) / k + 16, 2 * m.r + 70, Math.min(n, 6) * SP + 26);
        const cc = Math.max(1, Math.min(n || 1, Math.floor((w - 18) / SP))), rows = n ? Math.ceil(n / cc) : 0;
        // room under the topic for its label (≈ 24 px on screen), then its posts
        const lab = Math.max(40, 30 / k);
        return [m.id, { w, cols: cc, rows, lab, h: 2 * m.r + lab + 8 + (rows ? rows * SP + 8 : 0) }];
      }));
      place = [];
      if (relArr === "pillars") {
        let x = 0;
        cols.forEach((col, ci) => {
          if (ci) x += col.first ? GX_ * 2.4 : GX_;
          const w = Math.max(...col.list.map((m) => card.get(m.id).w));
          let y = TOP;
          for (const m of col.list) { const ind = Math.min(2, depthOf.get(m.id)) * 18; place.push({ m, x: x + w / 2 + ind, y, w, colX: x }); y += card.get(m.id).h + GY; totH = Math.max(totH, y); }
          x += GX_ * 0.8 + w;
        });
        for (const e of place) { e.x -= x / 2; e.colX -= x / 2; }
        totW = x;
      } else {
        const cw = Math.max(...ms.map((m) => card.get(m.id).w));
        const rowH = [];
        ms.forEach((m, i) => { const r = Math.floor(i / ncol); rowH[r] = Math.max(rowH[r] || 0, card.get(m.id).h); });
        const tw = ncol * cw + (ncol - 1) * GX_;
        let y = TOP;
        const rowY = rowH.map((h) => { const y0 = y; y += h + GY * 1.4; return y0; });
        ms.forEach((m, i) => place.push({ m, x: -tw / 2 + (i % ncol) * (cw + GX_) + cw / 2, y: rowY[Math.floor(i / ncol)], w: cw, row: Math.floor(i / ncol), rowY }));
        totW = tw + GX_ * 2; totH = y;
      }
      return clamp(Math.min((G.W - 80) / totW, (G.H - 330) / (totH + 60)), 0.05, 3);
    };
    // settle the zoom the layout will be seen at (cards are sized for it), damped so it can't oscillate
    const settleK = () => { let k = 0.5; for (let it = 0; it < 10; it++) { const k2 = layout(k); if (Math.abs(Math.log(k2 / k)) < 0.02) break; k = Math.sqrt(k * k2); } return k; };
    if (relArr === "pillars") {
      // how tall each pillar may get before it splits: whichever split lets the whole thing be seen largest
      // labels may take up to ~60% of the screen width; the rest is the topics' own room (posts, gaps, spines),
      // otherwise the zoom would have to shrink toward nothing to make room for them
      const LAB = 0.72 * SW;
      const capFor = (n) => clamp(Math.floor((LAB / n - 16) / 7.4), 10, 33);
      let best = null;
      for (let mr = 3; mr <= Math.max(3, ms.length); mr++) {
        cols = colsFor(mr); cap = capFor(cols.length);
        while (cap > 10 && cols.reduce((t, c) => t + Math.max(...c.list.map(labPx)), 0) > LAB) cap--;
        const k = settleK(), score = Math.min(k, 0.45) / 0.45 + 1.4 * Math.min(cap, 30) / 30;
        if (!best || score > best.score + 0.01) best = { mr, k, cap, score };
        if (cols.length <= order.length) break;   // no group is split any more
      }
      cols = colsFor(best.mr); cap = best.cap;
    } else {
      cap = clamp(Math.floor((0.84 * SW / ncol - 16) / 7.4), 12, 33);
    }
    for (const m of ms) m._labCap = cap;
    kz = settleK(); layout(kz);
    if (relArr === "grid") {
      // connectors as a comb: one trunk down the left, a bus line in the gap above each row, a short drop to each topic
      const tw = totW - GX_ * 2, rowY = place[0].rowY, tx = -tw / 2 - GX_ * 0.8, bus = (r) => rowY[r] - GY * 0.75;
      for (const e of place) { e.src = root.id; e.route = e.row === 0 ? [[0, bus(0)], [e.x, bus(0)]] : [[0, bus(0)], [tx, bus(0)], [tx, bus(e.row)], [e.x, bus(e.row)]]; }
    } else {
      // one spine per pillar, in the gutter on its left, with a short branch into each topic
      const busY = TOP - GY * 0.9, at0 = new Map(place.map((e) => [e.m.id, e]));
      for (const e of place) {
        const q = parOf(e.m), d = depthOf.get(e.m.id);
        if (!q || !at0.has(q)) { const sx = e.colX - GX_ * 0.6; e.src = root.id; e.route = [[0, busY], [sx, busY], [sx, e.y + e.m.r]]; }
        else { const P = at0.get(q), sx = e.colX - GX_ * 0.6 + 14 * Math.min(3, d); e.src = q; e.route = [[sx, P.y + P.m.r], [sx, e.y + e.m.r]]; }
      }
    }
    let bottom = TOP;
    const rel = [];
    for (const e of place) {
      const m = e.m, c = card.get(m.id), k = own.get(m.id).length;
      rel.push({ m, dx: e.x, dy: e.y + m.r });
      own.get(m.id).forEach((p, j) => rel.push({ p, owner: m.id, dx: e.x + ((j % c.cols) - (c.cols - 1) / 2) * SP, dy: e.y + 2 * m.r + c.lab + 8 + Math.floor(j / c.cols) * SP }));
      rel.push({ edge: true, dx: e.x - e.w / 2, dy: e.y }, { edge: true, dx: e.x + e.w / 2, dy: e.y + c.h });
      bottom = Math.max(bottom, e.y + c.h);
      if (!k) continue;
    }
    if (loose.length) {
      const cols = Math.max(8, Math.ceil(Math.sqrt(loose.length * 3)));
      const y0 = bottom + 70;
      loose.forEach((p, j) => rel.push({ p, owner: root.id, dx: ((j % cols) - (cols - 1) / 2) * SP, dy: y0 + Math.floor(j / cols) * SP }));
      bottom = y0 + Math.ceil(loose.length / cols) * SP;
    }
    const shift = -(bottom + 40) / 2;
    rootPos = at(0, shift);
    // routes are kept as offsets from the search node, so they follow it when it's dragged, and turn with it in 3D
    for (const e of place) e.m._rsrc = e.src;
    for (const e of place) e.m._route = e.route.map(([dx, dy]) => { const q = at(dx, dy + shift); return { x: q.x - rootPos.x, y: q.y - rootPos.y, z: q.z - rootPos.z }; });
    for (const e of rel) {
      const pos = at(e.dx, e.dy + shift);
      if (e.edge) targets.push({ ...pos, r: 0 });
      else if (e.m) { slotOf.set(e.m.id, { pos, ang: Math.PI / 2, dx: e.dx, dy: e.dy + shift }); targets.push({ ...pos, r: e.m.r + 20 }); }
      else { postTarget.set(e.p.id, pos); e.p.pullOwner = e.owner; }
    }
    targets.push({ ...rootPos, r: root.r + 40 });
  } else {
  const fan = (k, r0) => (k ? r0 + 14 + SP * 0.6 * Math.sqrt(k) + SP * 0.5 : r0 + 16);
  // radial node tree: the root in the middle, each level on its own ring, and every branch kept inside its own
  // wedge (sized by how much it holds), so links never cross and clusters don't pile onto each other
  const GAP = 30;
  const blob = new Map(g.members.map((m) => [m.id, fan(own.get(m.id).length, m.r)]));
  const inG = new Set(g.members.map((m) => m.id));
  const kidsT = new Map([[root.id, []]]);
  for (const m of g.members) kidsT.set(m.id, []);
  for (const m of g.members) kidsT.get(m.tp && inG.has(m.tp) && m.tp !== m.id ? m.tp : root.id).push(m);
  const wt = new Map();
  const weigh = (id) => { let sum = 0; for (const k of kidsT.get(id)) sum += weigh(k.id); const w = Math.max(id === root.id ? 0 : 2 * blob.get(id) + GAP, sum); wt.set(id, w); return w; };
  const Wt = weigh(root.id) || 1;
  const info = new Map(), byDepth = [];
  const assign = (id, a0, a1, d) => {
    const ks = kidsT.get(id); if (!ks.length) return;
    const tot = ks.reduce((t2, k) => t2 + wt.get(k.id), 0);
    const used = (a1 - a0) * Math.min(1, tot / (wt.get(id) || tot));
    let a = a0 + (a1 - a0 - used) / 2;
    for (const k of ks) {
      const da = used * wt.get(k.id) / tot;
      info.set(k.id, { ang: a + da / 2, wedge: da, d: d + 1, leaf: !kidsT.get(k.id).length });
      (byDepth[d + 1] = byDepth[d + 1] || []).push(k.id);
      assign(k.id, a, a + da, d + 1); a += da;
    }
  };
  // a lone branch gets a half-circle fan instead of a full ring
  const full = kidsT.get(root.id).length > 2 || g.members.length > 4;
  assign(root.id, full ? -Math.PI / 2 : 0, full ? Math.PI * 1.5 : Math.PI, 0);
  const R = [0], maxB = [root.r + 20], stag = [];
  for (let d = 1; d < byDepth.length; d++) {
    const ids = byDepth[d] || []; if (!ids.length) { R[d] = R[d - 1]; maxB[d] = 0; continue; }
    maxB[d] = Math.max(...ids.map((id) => blob.get(id)));
    // leaves crowded on a ring alternate between two radii, which halves the space they need around it
    stag[d] = ids.length > 8 && ids.every((id) => info.get(id).leaf);
    const need = Math.max(...ids.map((id) => (2 * blob.get(id) + GAP) / Math.max(0.02, info.get(id).wedge))) / (stag[d] ? 1.9 : 1);
    R[d] = Math.max(need, R[d - 1] + maxB[d - 1] + maxB[d] + 95, d === 1 ? 210 : 0);   // room for the labels between rings
  }
  const pos2 = new Map([[root.id, { x: 0, y: 0 }]]);
  g.members.forEach((m) => {
    const f = info.get(m.id), d = f.d, i = byDepth[d].indexOf(m.id);
    const rad = (R[d] + (stag[d] && i % 2 ? 2 * maxB[d] + GAP * 0.6 : 0)) * (relArr === "explode" ? 1.5 : 1);
    pos2.set(m.id, { x: Math.cos(f.ang) * rad, y: Math.sin(f.ang) * rad });
  });
  const midY = full ? 0 : -(R[R.length - 1] * (relArr === "explode" ? 1.5 : 1) + maxB[maxB.length - 1]) / 2;   // half-fan: centre it vertically
  g.members.forEach((m, i) => {
    const c = pos2.get(m.id), f = info.get(m.id);
    const pos = at(c.x, c.y + midY);
    slotOf.set(m.id, { pos, ang: f.ang, dx: c.x, dy: c.y + midY });
    targets.push({ ...pos, r: blob.get(m.id) });
  });
  rootPos = at(0, midY);
  const maxR = Math.max(0, ...g.members.map((m) => blob.get(m.id)));
  const Rm = g.members.length ? Math.max(...g.members.map((m) => Math.hypot(pos2.get(m.id).x, pos2.get(m.id).y))) : 0;
  for (const m of g.members) {
    const s = slotOf.get(m.id), hasKids = kidsT.get(m.id).length > 0;
    own.get(m.id).forEach((p, j) => {
      // a member's posts circle it; if it also has sub-topics, they sit to either side, clear of the links in and out
      const rad = m.r + 14 + SP * 0.6 * Math.sqrt(j + 0.5), a = hasKids ? s.ang + (j % 2 ? 1 : -1) * Math.PI * (0.5 + ((((j >> 1) * 0.618) % 1) - 0.5) * 0.45) : j * 2.399963 + s.ang;
      postTarget.set(p.id, at(s.dx + Math.cos(a) * rad, s.dy + Math.sin(a) * rad));
      p.pullOwner = m.id;
    });
  }
  const r0 = g.members.length ? Rm + maxR + 40 : root.r + 14;
  loose.forEach((p, j) => {
    const rad = r0 + SP * 0.6 * Math.sqrt(j + 0.5), a = j * 2.399963;
    postTarget.set(p.id, at(Math.cos(a) * rad, Math.sin(a) * rad + midY));
    p.pullOwner = root.id;
  });
  for (const t of postTarget.values()) targets.push({ ...t, r: 16 });
  targets.push({ ...rootPos, r: root.r + 20 });
  }
  // animate
  const orig = new Map();
  const now = performance.now();
  const dur = reduceMotion ? 1 : 850;
  orig.set(root.id, { x: root.x, y: root.y, z: root.z, pin: !!root.pin });
  root.pin = true;
  G.anims = G.anims.filter((a) => a.n !== root);
  G.anims.push({ n: root, from: { x: root.x, y: root.y, z: root.z }, to: rootPos, t0: now, dur: dur * 0.8, ease: easeInOut });
  const members = [];
  g.members.forEach((m, i) => {
    orig.set(m.id, { x: m.x, y: m.y, z: m.z, pin: !!m.pin });
    m.pin = true; members.push(m.id);
    G.anims = G.anims.filter((a) => a.n !== m);
    G.anims.push({ n: m, from: { x: m.x, y: m.y, z: m.z }, to: slotOf.get(m.id).pos, t0: now + Math.min(i * 24, 400), dur, ease: easeOutBack });
  });
  const posts = [];
  g.posts.forEach((p, j) => {
    p.free = true; posts.push(p.id);
    G.anims = G.anims.filter((a) => a.n !== p);
    G.anims.push({ n: p, from: { x: p.x, y: p.y, z: p.z }, to: postTarget.get(p.id), t0: now + 120 + Math.min(j * 5, 600), dur, ease: easeOutBack });
  });
  if (G._origKeep) for (const [k, v] of G._origKeep) if (relayout || orig.has(k)) orig.set(k, v);   // nodes keep their true home across focus hops
  G._origKeep = null;
  G.pulled = { root: root.id, members, posts, orig, kind: g.kind, cam0, tidy: !!lensBus };
  store.set("shook", true); $("#shake-hint").hidden = true;
  fitCamera(false, targets, 3);
  renderFocusBar(); renderNetCtl();
  const count = members.length + posts.length;
  if (relayout) { updateStatus(); kick(); return count; }
  if (g.kind === "projects by status") { const nP = g.members.filter((m) => m.kind === "note" && m.grp === "Projects" && !g.members.some((x) => x.tp === m.id)).length; toast(`Opened ${root.title}'s ${nP} projects, grouped by status. Shake again to send them back.`); updateStatus(); refreshPreview(); kick(); return count; }
  toast(g.kind === "relate" ? `Opened ${members.length} related topics and ${posts.length} posts. Drag the lens to move it all, shake again to send it back.` : `Opened ${members.length ? members.length + " " + g.kind : ""}${members.length && posts.length ? " and " : ""}${posts.length ? posts.length + " posts" : ""}. Shake again to send them back.`);
  updateStatus(); refreshPreview(); kick();
  return count;
}
function releasePull(fast, forRelayout) {
  const P = G.pulled;
  if (!P) return;
  if (!forRelayout) G.focusHist = [];
  if (forRelayout) G._origKeep = P.orig;
  const now = performance.now();
  const dur = fast || reduceMotion ? 1 : 750;
  for (const [id, o] of P.orig) {
    const n = G.byId.get(id); if (!n) continue;
    G.anims = G.anims.filter((a) => a.n !== n);
    G.anims.push({ n, from: { x: n.x, y: n.y, z: n.z }, to: { x: o.x, y: o.y, z: o.z }, t0: now, dur, ease: easeInOut, done: () => { n.pin = o.pin; } });
  }
  P.posts.forEach((pid, i) => { const p = G.postById.get(pid); if (p) { p.pullOwner = null; returnPost(p, fast ? 0 : Math.min(i * 3, 220), dur); } });
  if (!fast && P.cam0) animateCam({ k: P.cam0.k, tx: P.cam0.tx, ty: P.cam0.ty }, 700);
  G.pulled = null;
  renderFocusBar(); renderNetCtl();
  updateStatus(); refreshPreview(); kick();
}

/* ---------- preview card (click) ---------- */
function nodeData(id) { return G.byId.get(id) || G.postById.get(id) || null; }
/* hop-limited neighbourhood of a node: level 1 = node + its direct connections, 2 = two hops, 3 = everything */
function netSet(id, level) {
  if (level >= 3) return null;
  const start = nodeData(id); if (!start) return null;
  const seen = new Set([id]);
  let frontier = [id];
  const postsOf = new Map();
  for (const p of G.posts) { if (!postsOf.has(p.parentId)) postsOf.set(p.parentId, []); postsOf.get(p.parentId).push(p.id); }
  const nb = (x) => {
    const out = [];
    const n = nodeData(x);
    if (!n) return out;
    if (n.kind === "post") { out.push(n.parentId); return out; }
    for (const a of G.adj.get(x) || []) { if (!G.showAI && G.aiPairs && G.aiPairs.has(pairKey(x, a))) continue; out.push(a); }
    for (const pid of postsOf.get(x) || []) out.push(pid);
    if (n.kind === "lens" && G.relate) { for (const t of G.relate.top) out.push(t); for (const pid of G.relate.posts) out.push(pid); }
    return out;
  };
  for (let d = 0; d < level; d++) {
    const next = [];
    for (const x of frontier) for (const y of nb(x)) if (!seen.has(y)) { seen.add(y); next.push(y); }
    frontier = next;
    if (!frontier.length) break;
  }
  return seen;
}
function netSetCached(id, level) {
  const k = id + "|" + level + "|" + G.showAI + "|" + G.sig.length + "|" + G.posts.length + "|" + (G.relate ? G.relate.q : "");
  if (G.netCache && G.netCache.k === k) return G.netCache.v;
  const v = netSet(id, level);
  G.netCache = { k, v };
  return v;
}
function setNetLevel(l) {
  if (G.pulled) {
    // in focus: −/+ changes how deep the opened tree goes and re-lays it out
    const d = clamp(l, 1, 3);
    if (d !== G.pullDepth) { G.pullDepth = d; pulse(G.pulled.root); togglePull(G.pulled.root, true); }
    renderNetCtl(); kick();
    return;
  }
  const prev = G.netLevel;
  G.netLevel = clamp(l, 1, 3); store.set("netLevel", G.netLevel);
  if (G.selected && G.netLevel !== prev) {
    pulse(G.selected);
    const keep = G.netLevel < 3 ? netSet(G.selected, G.netLevel) : null;
    const pts = keep ? [...keep].map(nodeData).filter(Boolean) : null;
    fitCamera(false, pts && pts.length ? pts : null, pts && pts.length < 4 ? 3.5 : 4);
  }
  renderNetCtl(); kick();
}
/* ---------- colour-coded backdrop behind each main topic ---------- */
function drawBackdrops(ctx, fade) {
  const groups = new Map();
  for (const n of G.nodes) {
    if (n.kind === "core" || n.kind === "lens" || !n.grp || !n._p || (n._c || 0) > 0.9 || n._tl) continue;
    if (!groups.has(n.grp)) groups.set(n.grp, []);
    groups.get(n.grp).push(n);
  }
  const D3 = G.dim === 3;
  for (const [g, ns] of groups) {
    const col = GROUP_COL[g] || "#9fb0c8";
    const gn = G.byId.get("grp:" + g);
    const a = gn ? fade(gn) : 1;
    if (a < 0.05) continue;
    const panel = G.arrange !== "free" && G.arrange !== "explode" && G.arrT && G.arrT.panels && G.arrT.panels.find((q) => q.grp === g);
    if (panel) {
      if (D3) { drawVolume(ctx, panel, G.arrange === "pillars" ? ARR_DEPTH : ARR_DEPTH * 0.8, col, a); continue; }
      // pillars / sectors: the column or sector's full panel
      const cs = [[panel.x0, panel.y0], [panel.x1, panel.y0], [panel.x1, panel.y1], [panel.x0, panel.y1]].map(([x, y]) => projT(x, y, 0));
      const gr = ctx.createLinearGradient(0, Math.min(cs[0].y, cs[1].y), 0, Math.max(cs[2].y, cs[3].y));
      gr.addColorStop(0, rgba(col, 0.14 * a)); gr.addColorStop(1, rgba(col, 0.035 * a));
      ctx.fillStyle = gr; ctx.beginPath();
      roundRect(ctx, cs[0].x, cs[0].y, cs[1].x - cs[0].x, cs[3].y - cs[0].y, 18);
      ctx.fill(); ctx.strokeStyle = rgba(col, 0.3 * a); ctx.lineWidth = 1; ctx.stroke();
      continue;
    }
    if (G.arrange !== "free" && G.arrange !== "explode") {
      // fallback: a tinted panel around the column or sector's nodes
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ns) { const p = n._p, r = Math.max(n.rr || n.r, 14) * p.s; x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r); y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r); }
      const pad = 22 * Math.sqrt(Math.max(0.2, G.cam.k)), rad = 18;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, rgba(col, 0.13 * a)); gr.addColorStop(1, rgba(col, 0.04 * a));
      ctx.fillStyle = gr; ctx.beginPath(); roundRect(ctx, x0, y0, x1 - x0, y1 - y0, rad); ctx.fill();
      ctx.strokeStyle = rgba(col, 0.28 * a); ctx.lineWidth = 1; ctx.stroke();
      continue;
    }
    // free layout: a soft glow sized to the group's spread
    let cx = 0, cy = 0, w = 0;
    for (const n of ns) { const k = n.kind === "group" ? 6 : n.kind === "cat" ? 3 : 1; cx += n._p.x * k; cy += n._p.y * k; w += k; }
    cx /= w; cy /= w;
    const ds = ns.map((n) => Math.hypot(n._p.x - cx, n._p.y - cy) + Math.max(n.rr || n.r, 10) * n._p.s).sort((p, q) => p - q);
    const R = (ds[Math.floor(ds.length * 0.85)] || 60) + 30;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop(0, rgba(col, (D3 ? 0.13 : 0.15) * a)); gr.addColorStop(0.6, rgba(col, 0.06 * a)); gr.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  }
}

// 3D pillars / sectors: a translucent box (faces faint, edges brighter toward the camera)
const ARR_DEPTH = 170;
function drawVolume(ctx, P, dz, col, a) {
  const X = [P.x0, P.x1], Y = [P.y0, P.y1], Z = [-dz, dz];
  const v = []; for (const z of Z) for (const y of Y) for (const x of X) v.push(projT(x, y, z));
  // vertices: index = zi*4 + yi*2 + xi
  const faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  const depth = (f) => f.reduce((s2, i) => s2 + v[i].z, 0) / 4;
  for (const f of faces.slice().sort((p, q) => depth(q) - depth(p))) {
    ctx.beginPath(); ctx.moveTo(v[f[0]].x, v[f[0]].y); for (const i of f.slice(1)) ctx.lineTo(v[i].x, v[i].y); ctx.closePath();
    ctx.fillStyle = rgba(col, 0.035 * a); ctx.fill();
  }
  const edges = [[0, 1], [2, 3], [0, 2], [1, 3], [4, 5], [6, 7], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const zs = v.map((q) => q.z), zMin = Math.min(...zs), zMax = Math.max(...zs);
  ctx.lineWidth = 1;
  for (const [i, j] of edges) {
    const near = 1 - ((v[i].z + v[j].z) / 2 - zMin) / Math.max(1, zMax - zMin);
    ctx.strokeStyle = rgba(col, (0.1 + 0.32 * near) * a);
    ctx.beginPath(); ctx.moveTo(v[i].x, v[i].y); ctx.lineTo(v[j].x, v[j].y); ctx.stroke();
  }
}
/* ---------- focus bar (shown while a node is shaken open) ---------- */
// back to the focus you came from (without leaving focus mode)
function focusBack() {
  const H = G.focusHist || [];
  let prev = H.pop();
  while (prev && !nodeData(prev.root)) prev = H.pop();
  if (!prev || !G.pulled) { renderFocusBar(); renderNetCtl(); return; }
  G._back = true;
  try {
    G.pullDepth = prev.depth;
    pulse(prev.root);
    togglePull(prev.root, true);
  } finally { G._back = false; }
  if (G.selected && !inPulledGroup(G.selected)) hidePreview();
  renderFocusBar(); renderNetCtl();
}
function renderFocusBar() {
  const b = G.focusBar; if (!b) return;
  const P = G.pulled;
  b.hidden = !P;
  if (!P) return;
  const n = nodeData(P.root);
  const prev = (G.focusHist || []).length ? nodeData(G.focusHist[G.focusHist.length - 1].root) : null;
  b.replaceChildren(...[
    prev ? h("button", { type: "button", class: "fb-back", title: "Back to " + prev.title.replace(/^✦ /, ""), onclick: focusBack }, "← ", short(prev.title.replace(/^✦ /, ""), 22)) : null,
    h("span", { class: "fb-k" }, "Focus"),
    h("b", {}, short(n ? n.title.replace(/^✦ /, "") : "", 42)),
    h("button", { type: "button", class: "fb-x", onclick: () => releasePull() }, "Exit focus ✕")].filter(Boolean));
}

/* ---------- arrangements: free (physics), pillars (one column per main topic), grid (sectors) ---------- */
function notesInOrder(catId) {
  const kids = (id) => G.nodes.filter((n) => n.kind === "note" && n.tp === id).sort((a, b) => (b.hub ? 1 : 0) - (a.hub ? 1 : 0) || (b.posts || []).length - (a.posts || []).length);
  const out = [];
  const walk = (id) => { for (const n of kids(id)) { out.push(n); walk(n.id); } };
  walk(catId);
  return out;
}
function catBlock(c) {
  const notes = notesInOrder(c.id);
  const cw = Math.max(70, ...notes.map((n) => 2 * Math.max(n.rr || n.r, 14) + 28));
  return { c, notes, cw };
}
function shelfPack(items, targetW, gap) {
  const rows = [];
  let row = [], w = 0;
  for (const it of items) {
    if (row.length && w + gap + it.w > targetW) { rows.push(row); row = []; w = 0; }
    w += (row.length ? gap : 0) + it.w; row.push(it);
  }
  if (row.length) rows.push(row);
  let y = 0, W = 0;
  const pos = new Map();
  for (const r of rows) {
    const rw = r.reduce((s, it) => s + it.w, 0) + gap * (r.length - 1), rh = Math.max(...r.map((it) => it.h));
    let x = -rw / 2;
    for (const it of r) { pos.set(it, { x, y }); x += it.w + gap; }
    y += rh + gap; W = Math.max(W, rw);
  }
  return { pos, W, H: y - gap };
}
function arrangeTargets(mode) {
  const T = new Map();
  const panels = [];
  T.panels = panels;
  const groups = GROUP_ORDER.map((g) => G.byId.get("grp:" + g)).filter(Boolean);
  const catsOf = (g) => G.nodes.filter((n) => n.kind === "cat" && n.grp === g.grp).map(catBlock).sort((a, b) => b.notes.length - a.notes.length);
  // lay one category block out with its top-left corner at (x, y); returns its size
  const placeBlock = (B, cols, x, y, dry) => {
    const rows = Math.ceil(B.notes.length / cols) || 0;
    const w = Math.max(cols * B.cw, 2 * B.c.r + 120), hh = 2 * B.c.r + 36 + rows * B.cw;
    if (!dry) {
      T.set(B.c.id, { x: x + w / 2, y: y + B.c.r, z: 0 });
      B.notes.forEach((n, i) => {
        const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, B.notes.length - r * cols);
        // 3D: neighbouring columns step back and forth in depth so each pillar / sector fills its volume
        T.set(n.id, { x: x + w / 2 + (k - (inRow - 1) / 2) * B.cw, y: y + 2 * B.c.r + 36 + (r + 0.5) * B.cw, z: G.dim === 3 ? (((k + r) % 3) - 1) * ARR_DEPTH * 0.55 : 0 });
      });
    }
    return { w, h: hh };
  };
  const placeRealm = () => {
    const ts = REALM_GROUPS.map((g) => T.get("grp:" + g)).filter(Boolean);
    if (!ts.length || !G.byId.has(REALM_ID)) return;
    const ps = panels.filter((q) => REALM_SET.has(q.grp));
    const x = ts.reduce((a, q) => a + q.x, 0) / ts.length, y = Math.min(...ts.map((q) => q.y)) - 330;
    T.set(REALM_ID, { x, y, z: 0 });
    if (ps.length) T.realmPanel = { x0: Math.min(...ps.map((q) => q.x0)) - 24, x1: Math.max(...ps.map((q) => q.x1)) + 24, y0: y - 70, y1: Math.max(...ps.map((q) => q.y1)) + 24 };
  };
  if (mode === "explode") {
    // explode: one big radial tree from the core. Every branch gets its own slice of the circle sized by what it
    // holds, so everything spreads wide while each node stays just outside the node it belongs to
    const kids = new Map();
    for (const n of G.nodes) if (n.tp && n.kind !== "lens") { if (!kids.has(n.tp)) kids.set(n.tp, []); kids.get(n.tp).push(n.id); }
    for (const [, a] of kids) a.sort((x, y) => (G.byId.get(y).posts || []).length - (G.byId.get(x).posts || []).length);
    // keep the main topics in their usual order around the core
    if (kids.has("core")) kids.set("core", [...(G.byId.has(REALM_ID) ? [REALM_ID] : []), ...GROUP_ORDER.filter((g) => !G.byId.has(REALM_ID) || !REALM_SET.has(g)).map((g) => "grp:" + g).filter((id) => G.byId.has(id))]);
    if (kids.has(REALM_ID)) kids.set(REALM_ID, REALM_GROUPS.map((g) => "grp:" + g).filter((id) => G.byId.has(id)));
    const cloud = new Map();
    for (const p of G.posts) cloud.set(p.parentId, Math.max(cloud.get(p.parentId) || 0, Math.min(80, Math.hypot(p.ox || 0, p.oy || 0) + 6)));
    // nodes without posts (projects, people, scans) still need room for their names
    const size = (id) => { const n = G.byId.get(id); return Math.max(n.rr || n.r, 12) + (cloud.get(id) || 0) * 0.5 + (n.kind === "note" && !cloud.get(id) ? Math.min(44, String(n.title || "").length * 1.5) : 0); };
    // clear gaps between sibling categories (In Progress / Not Started / Done & Archived …) and between groups,
    // so each one flies out as its own cluster next to its own kind
    const sep = (id) => { const n = G.byId.get(id); return !n ? 0 : n.kind === "core" || n.kind === "realm" ? 70 : n.kind === "group" ? 90 : n.kind === "cat" ? 18 : 0; };
    const pos = radialTree("core", (id) => kids.get(id) || [], size, { gap: 26, ring: 90, r1: 260, sep });
    const D3 = G.dim === 3;
    // 3D: fit the burst inside the camera's depth and give it a gentle wave so it reads as a volume
    const maxR = Math.max(1, ...[...pos.values()].map((q) => q.rad));
    const f = D3 ? Math.min(1, 1250 / maxR) : 1;
    for (const [id, q] of pos) T.set(id, { x: q.x * f, y: q.y * f, z: D3 && q.d ? Math.sin(q.ang * 2 + q.d * 1.3) * q.rad * f * 0.28 : 0 });
    return T;
  }
  if (mode === "pillars") {
    const cols = groups.map((g) => {
      const blocks = catsOf(g).map((B) => { const c = B.notes.length > 12 ? 4 : B.notes.length > 6 ? 3 : B.notes.length > 2 ? 2 : 1; return { B, cols: c, ...placeBlock(B, c, 0, 0, true) }; });
      const w = Math.max(560, ...blocks.map((b) => b.w));
      return { g, blocks, w };
    });
    const gap = 200, total = cols.reduce((s, c) => s + c.w, 0) + gap * (cols.length - 1);
    let x = -total / 2;
    for (const C of cols) {
      const cx = x + C.w / 2;
      T.set(C.g.id, { x: cx, y: 0, z: 0 });
      let y = C.g.r + 90;
      for (const b of C.blocks) { placeBlock(b.B, b.cols, cx - b.w / 2, y, false); y += b.h + 60; }
      panels.push({ grp: C.g.grp, x0: cx - C.w / 2 - 30, x1: cx + C.w / 2 + 30, y0: -C.g.r - 50, y1: y - 20 });
      x += C.w + gap;
    }
    T.set("core", { x: 0, y: -230, z: 0 });
    // the inspiration columns first, then the work: order columns so Inspirations' groups sit together
    placeRealm();
    if (T.get(REALM_ID)) T.set("core", { x: 0, y: T.get(REALM_ID).y - 190, z: 0 });
  } else {
    // grid: each main topic is a sector; its categories are tiles packed inside it
    const sectors = groups.map((g) => {
      const tiles = catsOf(g).map((B) => { const c = Math.max(1, Math.ceil(Math.sqrt(B.notes.length * 1.4))); return { B, cols: c, ...placeBlock(B, c, 0, 0, true) }; });
      const area = tiles.reduce((s, t) => s + (t.w + 50) * (t.h + 50), 0);
      const pk = shelfPack(tiles, Math.max(Math.sqrt(area) * 1.25, ...tiles.map((t) => t.w)), 50);
      const head = 2 * g.r + 70;
      return { g, tiles, pk, w: Math.max(pk.W, 2 * g.r + 200) + 60, h: pk.H + head + 50, head };
    });
    const area = sectors.reduce((s, t) => s + (t.w + 90) * (t.h + 90), 0);
    const SP = shelfPack(sectors, Math.max(Math.sqrt(area) * 1.35, ...sectors.map((t) => t.w)), 90);
    const oy = -SP.H / 2;
    for (const S of sectors) {
      const p = SP.pos.get(S);
      const sx = p.x + S.w / 2, sy = oy + p.y;
      T.set(S.g.id, { x: sx, y: sy + 30 + S.g.r, z: 0 });
      panels.push({ grp: S.g.grp, x0: p.x, x1: p.x + S.w, y0: sy, y1: sy + S.h });
      for (const t of S.tiles) { const q = S.pk.pos.get(t); placeBlock(t.B, t.cols, sx + q.x, sy + S.head + q.y, false); }
    }
    T.set("core", { x: 0, y: oy - 200, z: 0 });
    placeRealm();
    if (T.get(REALM_ID)) T.set("core", { x: 0, y: Math.min(oy - 200, T.get(REALM_ID).y - 150), z: 0 });
  }
  // centre the whole chart (not Capability Development) on the origin, so framing, zooming, orbiting and
  // turning the tree all pivot around the middle of the pillars / grid
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [id, q] of T) { const n = G.byId.get(id), r = n ? (n.rr || n.r || 10) : 10; x0 = Math.min(x0, q.x - r); x1 = Math.max(x1, q.x + r); y0 = Math.min(y0, q.y - r - 40); y1 = Math.max(y1, q.y + r); }
  for (const q of panels.concat(T.realmPanel || [])) { x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x1); y0 = Math.min(y0, q.y0); y1 = Math.max(y1, q.y1); }
  if (isFinite(x0)) {
    const dx = (x0 + x1) / 2, dy = (y0 + y1) / 2;
    for (const q of T.values()) { q.x -= dx; q.y -= dy; }
    for (const q of panels.concat(T.realmPanel || [])) { q.x0 -= dx; q.x1 -= dx; q.y0 -= dy; q.y1 -= dy; }
  }
  return T;
}
// radial node tree: the root in the middle, each level on its own ring, every branch inside its own wedge
// (sized by how much it holds) so branches never cross; crowded rings of leaves alternate between two radii
function radialTree(rootId, kidsOf, sizeOf, o = {}) {
  const GAP = o.gap ?? 30, wt = new Map(), info = new Map(), byDepth = [];
  // o.sep(id): extra room between the children of id, so sibling branches read as separate clusters
  const sepOf = (id) => (o.sep ? o.sep(id) : 0);
  const weigh = (id) => { let sum = 0; const ks = kidsOf(id); for (const k of ks) sum += weigh(k); sum += Math.max(0, ks.length - 1) * sepOf(id); const w = Math.max(id === rootId ? 0 : 2 * sizeOf(id) + GAP, sum); wt.set(id, w); return w; };
  weigh(rootId);
  const assign = (id, a0, a1, d) => {
    const ks = kidsOf(id); if (!ks.length) return;
    const sp = sepOf(id) * Math.max(0, ks.length - 1);
    const tot = (ks.reduce((t2, k) => t2 + wt.get(k), 0) + sp) || 1;
    const used = (a1 - a0) * Math.min(1, tot / (wt.get(id) || tot));
    let a = a0 + (a1 - a0 - used) / 2;
    const gapA = used * sepOf(id) / tot;
    for (const k of ks) {
      const da = used * wt.get(k) / tot;
      info.set(k, { ang: a + da / 2, wedge: da, d: d + 1, leaf: !kidsOf(k).length });
      (byDepth[d + 1] = byDepth[d + 1] || []).push(k);
      assign(k, a, a + da, d + 1); a += da + gapA;
    }
  };
  assign(rootId, o.a0 ?? -Math.PI / 2, o.a1 ?? Math.PI * 1.5, 0);
  const R = [0], maxB = [sizeOf(rootId) + 20], stag = [];
  for (let d = 1; d < byDepth.length; d++) {
    const ids = byDepth[d] || []; if (!ids.length) { R[d] = R[d - 1]; maxB[d] = 0; continue; }
    maxB[d] = Math.max(...ids.map(sizeOf));
    stag[d] = ids.length > 8 && ids.filter((id) => info.get(id).leaf).length > ids.length * 0.6;
    const need = Math.max(...ids.map((id) => (2 * sizeOf(id) + GAP) / Math.max(0.02, info.get(id).wedge))) / (stag[d] ? 1.9 : 1);
    R[d] = Math.max(need, R[d - 1] + maxB[d - 1] + maxB[d] + (o.ring ?? 95), d === 1 ? (o.r1 ?? 210) : 0);
  }
  const out = new Map([[rootId, { x: 0, y: 0, ang: 0, d: 0, rad: 0 }]]);
  for (let d = 1; d < byDepth.length; d++) (byDepth[d] || []).forEach((id, i) => {
    const f = info.get(id), rad = R[d] + (stag[d] && f.leaf && i % 2 ? 2 * maxB[d] + GAP * 0.6 : 0);
    out.set(id, { x: Math.cos(f.ang) * rad, y: Math.sin(f.ang) * rad, ang: f.ang, d, rad });
  });
  return out;
}
function applyArrange(anim) {
  if (G.arrange === "free" || !G.nodes.length) return;
  const T = arrangeTargets(G.arrange);
  const now = performance.now(), dur = anim && !reduceMotion ? 900 : 0;
  G.alpha = 0;
  for (const n of G.nodes) {
    const t = T.get(n.id); if (!t) continue;
    n.pin = true; n.vx = n.vy = n.vz = 0;
    G.anims = G.anims.filter((a) => a.n !== n);
    if (!dur) { n.x = t.x; n.y = t.y; n.z = t.z; continue; }
    G.anims.push({ n, from: { x: n.x, y: n.y, z: n.z }, to: t, t0: now, dur, ease: easeInOut });
  }
  G.arrT = T;
  applyPins();
  placeLens();
  syncPosts();
  kick();
}
function setArrange(m) {
  if (G.arrange === m) return;
  { const prev = G.arrange; const nm = (x) => x[0].toUpperCase() + x.slice(1); histPush({ label: `Layout ${nm(prev)} → ${nm(m)}`, undo: () => setArrange(prev), redo: () => setArrange(m) }); }
  const reopen = G.pulled ? { root: G.pulled.root, depth: G.pullDepth } : null;
  releasePull(true);
  if (reopen) setTimeout(() => { if (!G.pulled && G.arrange === m && nodeData(reopen.root)) { G.fitAfter = 0; G._back = true; togglePull(reopen.root); G._back = false; if (reopen.depth !== G.pullDepth) { G.pullDepth = reopen.depth; togglePull(reopen.root, true); } } }, reduceMotion ? 0 : 1050);
  const prev = G.arrange;
  if (prev === "free") G.freePos = new Map(G.nodes.map((n) => [n.id, { x: n.x, y: n.y, z: n.z }]));
  G.arrange = m; store.set("arrange", m);
  const now = performance.now();
  if (m === "free") {
    G.arrT = null;
    const FP = G.freePos;
    for (const n of G.nodes) {
      if (n.kind === "core" || n.kind === "lens") continue;
      const o = FP && FP.get(n.id);
      G.anims = G.anims.filter((a) => a.n !== n);
      if (o && !reduceMotion) G.anims.push({ n, from: { x: n.x, y: n.y, z: n.z }, to: o, t0: now, dur: 900, ease: easeInOut, done: () => { n.pin = false; } });
      else n.pin = false;
    }
    if (G.byId.get("core")) { const c = G.byId.get("core"); G.anims.push({ n: c, from: { x: c.x, y: c.y, z: c.z }, to: { x: 0, y: 0, z: 0 }, t0: now, dur: 900, ease: easeInOut }); }
    setTimeout(() => { applyPins(); G.alpha = Math.max(G.alpha, 0.08); placeLens(); kick(); }, reduceMotion ? 0 : 950);
  } else {
    if (G.dim === 3) animateCam({ yaw: 0.28, pitch: -0.16 }, 700);
    applyArrange(true);
  }
  G.fitAfter = now + (reduceMotion ? 0 : 1000);
  syncControls(); kick();
}
// the −/+ depth control follows the shaken-open node (focus) or else the selected node
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
function netTarget() { return G.pulled ? G.pulled.root : G.selected; }
function renderNetCtl() {
  const c = $("#netctl"); if (!c) return;
  const id = netTarget();
  const on = !!id && st.view === "graph" && !!nodeData(id);
  c.hidden = !on;
  if (!on) return;
  const L = G.pulled ? G.pullDepth : G.netLevel;
  const tip = G.pulled
    ? (L === 1 ? "Opened: direct items only" : L === 2 ? "Opened: items and their posts" : "Opened: everything underneath")
    : (L === 1 ? "Showing this node and its direct connections" : L === 2 ? "Showing two steps of connections" : "Showing the whole network");
  c.classList.toggle("pulled", !!G.pulled);
  const back = G.pulled && (G.focusHist || []).length;
  c.replaceChildren(...[
    back ? h("button", { type: "button", class: "nc-btn nc-back", "aria-label": "Back to the previous focus", title: "Back to the previous focus", onclick: focusBack }, "←") : null,
    h("button", { type: "button", class: "nc-btn", "aria-label": "Show fewer connections", title: "Contract", disabled: L <= 1 ? "" : null, onclick: () => setNetLevel(L - 1) }, "−"),
    h("span", { class: "nc-dots", title: tip, "aria-label": tip }, [1, 2, 3].map((i) => h("i", { class: i <= L ? "on" : "" }))),
    h("button", { type: "button", class: "nc-btn", "aria-label": "Show more connections", title: "Expand", disabled: L >= 3 ? "" : null, onclick: () => setNetLevel(L + 1) }, "+"),
    G.pulled ? h("button", { type: "button", class: "nc-btn nc-x", "aria-label": "Exit focus mode", title: "Exit focus (Esc)", onclick: () => releasePull() }, h("span", { class: "nc-xl" }, "Exit"), "✕") : null].filter(Boolean));
  placeNetCtl();
}
function placeNetCtl() {
  const c = $("#netctl");
  if (!c || c.hidden) return;
  if (COARSE) { c.style.transform = ""; return; }   // phones: docked at the bottom by CSS
  const gn = nodeData(netTarget());
  if (!gn || !gn._p) { c.style.transform = "translate(-999px,-999px)"; return; }
  const p = gn._p, rr = (gn._hr || gn.r * p.s) + (G.pulled && G.pulled.root === gn.id ? 30 : 0);   // clear the parent box and its tag
  const w = c.offsetWidth || 74, hh = c.offsetHeight || 22;
  let y = p.y - rr - hh - 12;
  // keep clear of the focus bar at the top: drop below the node instead
  const fb = G.focusBar && !G.focusBar.hidden ? G.focusBar.offsetTop + G.focusBar.offsetHeight + 8 : 4;
  if (y < fb) y = p.y + rr + 12;
  c.style.transform = `translate(${Math.round(clamp(p.x - w / 2, 4, G.W - w - 4))}px,${Math.round(clamp(y, 4, G.H - hh - 4))}px)`;
}
function nearSet(id) {
  const n = nodeData(id); if (!n) return null;
  const s = new Set([id]);
  let p = n.kind === "post" ? G.byId.get(n.parentId) : G.byId.get(n.tp);
  if (n.kind === "post") s.add(n.parentId);
  while (p) { s.add(p.id); p = G.byId.get(p.tp); }
  if (n.kind === "post") return s;
  for (const a of G.adj.get(id) || []) s.add(a);
  if (n.kind !== "note") for (const m of G.nodes) { let q = m; while (q && q.tp) { if (q.tp === id) { s.add(m.id); break; } q = G.byId.get(q.tp); } }
  for (const p2 of G.posts) if (s.has(p2.parentId) && (p2.parentId === id || n.kind !== "note")) s.add(p2.id);
  if (n.kind === "lens" && G.relate) { for (const nid of G.relate.top) s.add(nid); for (const pid of G.relate.posts) s.add(pid); }
  return s;
}
function showPreview(id) {
  if (G.renaming !== id) G.renaming = null;
  G.selected = id;
  st.selected = st.notes.has(id) ? id : null;
  hideHover();
  refreshPreview();
  applyHighlight();
  renderNetCtl();
}
function hidePreview() { $("#preview").hidden = true; G.renaming = null; G.selected = null; st.selected = null; applyHighlight(); renderNetCtl(); kick(); }
function mosaic(posts, size) {
  return h("div", { class: "pv-mosaic" }, posts.map((p) => {
    const el = thumbEl(p.code, size, "th");
    return el ? h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", title: (p.handle ? "@" + p.handle + ": " : "") + p.title, onmouseenter: () => { G.hover = p.id; kick(); }, onmouseleave: () => { G.hover = null; kick(); } }, el) : null;
  }));
}
/* ---------- rename: name on the map + full title, for every kind of node ---------- */
function canRename(gn) {
  if (!gn || gn.kind === "lens") return false;
  if (gn.kind === "note") return canModify(st.notes.get(gn.id));
  if (gn.kind === "post") return canModify(st.notes.get(gn.parentId));
  return !!st.canAdmin && gn.id !== "cat:_none";
}
function renameFields(gn) {
  if (gn.kind === "note") { const n = st.notes.get(gn.id) || {}; return { name: n.name || "", title: n.title || "", namePh: "Same as title", nameHelp: "Short label shown on the map", titleHelp: "Full title. Links to it are updated too" }; }
  if (gn.kind === "post") return { name: gn.name || "", title: gn.title || "", namePh: gn.handle ? "@" + gn.handle : "", nameHelp: "Label shown on the map", titleHelp: "Description" };
  if (gn.kind === "cat") { const c = catById(gn.ck) || {}; return { name: c.name || "", title: c.title || "", namePh: "", nameHelp: "Category name", titleHelp: "Longer title (optional)" }; }
  const l = metaLabel(gn.id);
  return { name: l.name || "", title: l.title || "", namePh: gn.kind === "core" ? "Inspirations" : gn.kind === "realm" ? "Inspirations" : gn.grp, nameHelp: gn.kind === "core" ? "Name of the map" : gn.kind === "realm" ? "Branch name" : "Group name", titleHelp: "Longer title (optional)" };
}
function renameForm(gn) {
  const f = renameFields(gn);
  const nm = h("input", { type: "text", value: f.name, placeholder: f.namePh, maxlength: "60", "aria-label": "Name" });
  const tt = h("input", { type: "text", value: f.title, maxlength: gn.kind === "post" ? "160" : "200", "aria-label": "Title" });
  const save = async () => { const ok = await renameNode(gn.id, nm.value.trim(), tt.value.trim()); if (ok !== false) { G.renaming = null; refreshPreview(); } };
  const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") { e.stopPropagation(); G.renaming = null; refreshPreview(); } };
  nm.addEventListener("keydown", onKey); tt.addEventListener("keydown", onKey);
  setTimeout(() => nm.focus(), 20);
  return h("div", { class: "pv-rename" },
    h("label", null, h("span", { class: "mono-lbl" }, "Name"), nm, h("span", { class: "helper" }, f.nameHelp)),
    h("label", null, h("span", { class: "mono-lbl" }, "Title"), tt, h("span", { class: "helper" }, f.titleHelp)),
    h("div", { class: "pv-actions" }, h("button", { class: "btn small primary", onclick: save }, "Save"), h("button", { class: "btn small ghost", onclick: () => { G.renaming = null; refreshPreview(); } }, "Cancel")));
}
/* ---------- timeline: inception dates, playhead, in/out points, playback, range filters ---------- */
const TL_SPEEDS = [
  { ms: 2000, days: 1, label: "2 s / day" }, { ms: 1000, days: 1, label: "1 s / day" }, { ms: 500, days: 1, label: "0.5 s / day" },
  { ms: 500, days: 7, label: "1 week / 0.5 s" }, { ms: 500, days: 30.44, label: "1 month / 0.5 s" }];
const TL = { t0: 0, t1: 1, head: null, in: store.get("tlIn", null), out: store.get("tlOut", null), playing: false, speed: 2,
  crop: store.get("tlCrop", null), armed: null, marks: [], weeks: [], hiddenCrop: 0, hiddenFuture: 0, show: store.get("tlShow", true), drag: null, lastTs: 0 };
const MARK_COL = { due: "#ff4d5e", mile: "#ffc145", event: "#fde68a" };
function weekStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
const DTF = new Map();
const DAYFMT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtDay = (t) => DAYFMT.format(t);
// every note and post gets an inception time (t0); parents start no later than their earliest child
function tlDates() {
  const now = Date.now();
  const notes = G.nodes.filter((n) => n.kind === "note");
  for (const n of G.nodes) n.t0 = -Infinity;
  for (const n of notes) {
    let t = n.date || null;
    if (t == null) for (const p of n.posts || []) if (p.date && (t == null || p.date < t)) t = p.date;
    n.t0 = t != null ? t : n.created || now;
  }
  for (const n of notes.slice().sort((a, b) => (b.depth || 0) - (a.depth || 0))) { const p = G.byId.get(n.tp); if (p && p.kind === "note" && n.t0 < p.t0) p.t0 = n.t0; }
  const minOf = (arr) => arr.reduce((m, x) => Math.min(m, x), Infinity);
  for (const c of G.nodes) if (c.kind === "cat") { const v = minOf(notes.filter((n) => n.ck === c.ck).map((n) => n.t0)); c.t0 = isFinite(v) ? v : -Infinity; }
  for (const g of G.nodes) if (g.kind === "group") { const v = minOf(G.nodes.filter((c) => c.kind === "cat" && c.grp === g.grp && isFinite(c.t0)).map((c) => c.t0)); g.t0 = isFinite(v) ? v : -Infinity; }
  for (const r of G.nodes) if (r.kind === "realm") { const v = minOf(G.nodes.filter((g) => g.tp === r.id && isFinite(g.t0)).map((g) => g.t0)); r.t0 = isFinite(v) ? v : -Infinity; }
  for (const p of G.posts) { const par = G.byId.get(p.parentId); p.t0 = (p.post && p.post.date) || (par ? par.t0 : now); }
  // markers: deadlines, next milestones, company events
  TL.marks = [];
  for (const n of notes) {
    for (const [k, f] of [["due", "due"], ["mile", "milestone"], ["event", "event"]]) { const t = dayMs(n[f]); if (t) TL.marks.push({ kind: k, t, id: n.id, title: n.name || n.title, done: n.status === "Done" || n.status === "Canceled" }); }
  }
  // range: oldest entry → latest of (newest entry, today, furthest marker), in whole weeks
  let lo = Infinity, hi = now;
  for (const n of notes) { lo = Math.min(lo, n.t0); hi = Math.max(hi, n.t0); }
  for (const p of G.posts) { lo = Math.min(lo, p.t0); hi = Math.max(hi, p.t0); }
  if (!isFinite(lo)) lo = now - 8 * WEEK;
  // far right = the latest entry (or today), plus a short look-ahead for upcoming deadlines; later ones gather at the edge
  TL.t0 = weekStart(lo); TL.t1 = weekStart(hi) + 13 * WEEK;
  TL.later = TL.marks.filter((m) => m.t >= TL.t1).sort((a, b) => a.t - b.t);
  // entries per week (for the activity strip)
  const nW = Math.max(1, Math.round((TL.t1 - TL.t0) / WEEK));
  TL.weeks = new Array(nW).fill(0);
  const bump = (t) => { const i = Math.floor((t - TL.t0) / WEEK); if (i >= 0 && i < nW) TL.weeks[i]++; };
  notes.forEach((n) => bump(n.t0)); G.posts.forEach((p) => bump(p.t0));
  // entries per day (shown when the timeline is zoomed in far enough)
  const nD = Math.max(1, Math.round((TL.t1 - TL.t0) / DAY));
  TL.days = new Array(nD).fill(0);
  const bumpD = (t) => { const i = Math.floor((t - TL.t0) / DAY); if (i >= 0 && i < nD) TL.days[i]++; };
  notes.forEach((n) => bumpD(n.t0)); G.posts.forEach((p) => bumpD(p.t0));
  if (TL.v0 != null && (TL.v0 < TL.t0 || TL.v1 > TL.t1 || TL.v1 - TL.v0 < TL_MIN_SPAN)) TL.v0 = TL.v1 = null;
  if (TL.in != null && (TL.in < TL.t0 || TL.in >= TL.t1)) TL.in = null;
  if (TL.out != null && (TL.out <= TL.t0 || TL.out > TL.t1)) TL.out = null;
}
const tlIn = () => (TL.in == null ? TL.t0 : TL.in);
const tlOut = () => (TL.out == null ? TL.t1 : TL.out);
function cropHit(t) { const c = TL.crop; if (!c) return false; return c.mode === "hide" ? t >= c.a && t < c.b : t < c.a || t >= c.b; }
// decide what is hidden: not yet born (after the playhead) or cut by the range filter
function tlApply() {
  const head = TL.head == null ? Infinity : TL.head;
  const now = performance.now();
  let hc = 0, hf = 0, born = 0;
  const vis = new Set();
  // nodes hidden with the eye (and everything under them) — separate from the timeline filter
  const U = new Set();
  if (G.userHidden.size) for (const n of G.nodes) { let q = n; while (q) { if (G.userHidden.has(q.id)) { U.add(n.id); break; } q = G.byId.get(q.tp); } }
  const set = (n, hid) => {
    if (n._tl && !hid && TL.playing) { n._born = now; if (n.kind === "note" && born++ < 3) G.pulses.push({ id: n.id, t0: now }); }
    n._tl = hid;
  };
  for (const n of G.nodes) if (n.kind === "note") {
    const fut = n.t0 > head, cut = cropHit(n.t0);
    if (fut) hf++; else if (cut) hc++;
    if (!fut && !cut && !U.has(n.id)) vis.add(n.id);
  }
  // keep the parents of anything visible, so nothing floats without its branch
  for (const id of [...vis]) { let p = G.byId.get(G.byId.get(id).tp); while (p && p.kind === "note" && !vis.has(p.id)) { vis.add(p.id); p = G.byId.get(p.tp); } }
  for (const n of G.nodes) if (n.kind === "note") set(n, !vis.has(n.id));
  for (const p of G.posts) {
    const par = G.byId.get(p.parentId);
    const fut = p.t0 > head, cut = cropHit(p.t0);
    if (fut) hf++; else if (cut) hc++;
    set(p, fut || cut || !par || !!par._tl || G.userHidden.has(p.id));
  }
  const anyNote = (pred) => G.nodes.some((m) => m.kind === "note" && !m._tl && pred(m));
  for (const c of G.nodes) if (c.kind === "cat") set(c, U.has(c.id) || (isFinite(c.t0) ? !anyNote((m) => m.ck === c.ck) : c.t0 > head));
  for (const g of G.nodes) if (g.kind === "group") set(g, U.has(g.id) || !G.nodes.some((c) => c.kind === "cat" && c.grp === g.grp && !c._tl));
  for (const r of G.nodes) if (r.kind === "realm") set(r, U.has(r.id) || !G.nodes.some((g) => g.tp === r.id && !g._tl));
  syncHiddenUi();
  TL.hiddenCrop = hc; TL.hiddenFuture = hf;
  if (G.selected && nodeData(G.selected) && nodeData(G.selected)._tl) hidePreview();
  syncTimelineUi();
  kick();
}
function tlInit() {
  const wrap = G.wrap;
  const speedLbl = h("span", { class: "tl-speed-l", id: "tl-speed-l" }, TL_SPEEDS[TL.speed].label);
  const cv = h("canvas", { class: "tl-cv", id: "tl-cv", tabindex: "0", role: "slider", "aria-label": "Timeline. Arrow keys move the playhead, I and O set in and out points, space plays, plus and minus zoom, 0 fits." });
  const tip = h("div", { class: "tl-tip", id: "tl-tip", hidden: "" });
  const bar = h("div", { class: "timeline hud", id: "timeline" },
    h("div", { class: "tl-ctl" },
      h("button", { type: "button", class: "tl-play", id: "tl-play", "aria-label": "Play the timeline", title: "Play (space)", onclick: () => tlPlay(!TL.playing) }, "▶"),
      h("div", { class: "tl-speed", role: "group", "aria-label": "Playback speed" },
        h("button", { type: "button", class: "tl-sp", "aria-label": "Slower", title: "Slower", onclick: () => tlSpeed(-1) }, "−"), speedLbl,
        h("button", { type: "button", class: "tl-sp", "aria-label": "Faster", title: "Faster", onclick: () => tlSpeed(1) }, "+"))),
    h("div", { class: "tl-track" }, cv, tip),
    h("div", { class: "tl-side" },
      h("span", { class: "tl-date", id: "tl-date" }),
      h("div", { class: "seg small tl-crop", role: "group", "aria-label": "Range filter" },
        h("button", { type: "button", "data-crop": "hide", title: "Hide everything between the in and out points", onclick: () => tlCrop("hide") }, h("span", { class: "l-long" }, "Hide range"), h("span", { class: "l-short" }, "Hide")),
        h("button", { type: "button", "data-crop": "keep", title: "Keep only what is between the in and out points", onclick: () => tlCrop("keep") }, h("span", { class: "l-long" }, "Keep range"), h("span", { class: "l-short" }, "Keep"))),
      h("button", { type: "button", class: "tl-hidden", id: "tl-hidden", hidden: "", title: "Show everything again", onclick: () => tlCrop(null) })));
  wrap.append(bar);
  TL.cv = cv; TL.ctx = cv.getContext("2d"); TL.tip = tip;
  if (window.ResizeObserver) new ResizeObserver(() => tlDraw()).observe(cv);
  cv.addEventListener("pointerdown", tlDown);
  cv.addEventListener("pointermove", tlMove);
  cv.addEventListener("pointerup", tlUp);
  cv.addEventListener("pointercancel", tlUp);
  cv.addEventListener("pointerleave", () => { if (!TL.drag) TL.tip.hidden = true; });
  cv.addEventListener("dblclick", tlDbl);
  cv.addEventListener("wheel", tlWheel, { passive: false });
  cv.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
  cv.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  cv.addEventListener("keydown", tlKey);
  wrap.classList.toggle("has-tl", TL.show);
  bar.hidden = !TL.show;
}
// the visible window of the timeline (zoom with the wheel or a pinch, pan with a middle-drag, two fingers or shift+wheel)
const TL_MIN_SPAN = 4 * DAY;
const tlV0 = () => (TL.v0 == null ? TL.t0 : TL.v0), tlV1 = () => (TL.v1 == null ? TL.t1 : TL.v1);
function tlGeom() {
  const cv = TL.cv, W = cv.clientWidth, H = cv.clientHeight;
  const pad = 12, x0 = pad, x1 = W - pad, V0 = tlV0(), V1 = tlV1();
  const X = (t) => x0 + ((t - V0) / (V1 - V0)) * (x1 - x0);
  const T = (x) => V0 + ((x - x0) / (x1 - x0)) * (V1 - V0);
  return { W, H, x0, x1, X, T, V0, V1, pxDay: (x1 - x0) / ((V1 - V0) / DAY), mT: 2, mB: 13, tT: 15, tB: H - 13 };
}
function tlSetView(a, b) {
  const full = TL.t1 - TL.t0;
  let span = clamp(b - a, TL_MIN_SPAN, full);
  if (span >= full - DAY / 2) { TL.v0 = TL.v1 = null; }
  else {
    a = clamp(a, TL.t0, TL.t1 - span);
    TL.v0 = a; TL.v1 = a + span;
  }
  tlDraw();
}
function tlZoomAt(tc, f) {
  const V0 = tlV0(), V1 = tlV1(), span = clamp((V1 - V0) * f, TL_MIN_SPAN, TL.t1 - TL.t0), r = (tc - V0) / (V1 - V0);
  tlSetView(tc - r * span, tc - r * span + span);
}
function tlPan(dt) { tlSetView(tlV0() + dt, tlV1() + dt); }
function tlWheel(e) {
  e.preventDefault();
  const { x } = tlXY(e), g = tlGeom(), span = g.V1 - g.V0;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) tlPan(((e.deltaX || e.deltaY) / (g.x1 - g.x0)) * span);
  else tlZoomAt(clamp(g.T(x), TL.t0, TL.t1), Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0022)));
  TL.tip.hidden = true;
}
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function hatch(ctx) {
  if (TL.hatch) return TL.hatch;
  const c = document.createElement("canvas"); c.width = c.height = 6;
  const g = c.getContext("2d"); g.strokeStyle = "rgba(255,92,138,.55)"; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.stroke();
  return (TL.hatch = ctx.createPattern(c, "repeat"));
}
function tlDraw() {
  const cv = TL.cv; if (!cv || !TL.show || G.wrap.hidden) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const { W, H, x0, x1, X, mT, mB, tT, tB } = tlGeom();
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = TL.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const a = tlIn(), b = tlOut(), head = TL.head == null ? TL.t1 : TL.head;
  // track
  ctx.fillStyle = "rgba(255,255,255,.035)"; ctx.beginPath(); roundRect(ctx, x0, tT, x1 - x0, tB - tT, 5); ctx.fill();
  const { V0, V1, pxDay } = tlGeom();
  ctx.save(); ctx.beginPath(); ctx.rect(x0 - 7, 0, x1 - x0 + 14, H); ctx.clip();
  // activity per week, or per day once there's room for each day
  const byDay = pxDay >= 5, bins = byDay ? TL.days : TL.weeks, step = byDay ? DAY : WEEK;
  const max = Math.max(1, ...bins), bpx = pxDay * (byDay ? 1 : 7);
  const i0 = Math.max(0, Math.floor((V0 - TL.t0) / step) - 1), i1 = Math.min(bins.length - 1, Math.ceil((V1 - TL.t0) / step) + 1);
  for (let i = i0; i <= i1; i++) {
    const c = bins[i]; if (!c) continue;
    const t = TL.t0 + i * step, hh = Math.max(2, Math.sqrt(c / max) * (tB - tT - 4));
    ctx.fillStyle = t > head ? "rgba(56,225,255,.13)" : "rgba(56,225,255,.5)";
    ctx.fillRect(X(t) + 0.5, tB - 2 - hh, Math.max(1, bpx - (bpx > 4 ? 2 : 1)), hh);
  }
  // range filter (hatched = hidden)
  if (TL.crop) {
    ctx.fillStyle = hatch(ctx);
    const segs = TL.crop.mode === "hide" ? [[TL.crop.a, TL.crop.b]] : [[TL.t0, TL.crop.a], [TL.crop.b, TL.t1]];
    for (const [s, e] of segs) if (e > s) ctx.fillRect(X(s), tT, X(e) - X(s), tB - tT);
  }
  // outside in/out: shaded
  ctx.fillStyle = "rgba(4,7,13,.6)";
  if (a > TL.t0) ctx.fillRect(x0, tT, X(a) - x0, tB - tT);
  if (b < TL.t1) ctx.fillRect(X(b), tT, x1 - X(b), tB - tT);
  // ticks and labels: months → weeks → single days as you zoom in
  ctx.font = `500 9.5px ${getVar("--font-mono")}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const fmt = (t, o) => { const k = JSON.stringify(o); let f = DTF.get(k); if (!f) DTF.set(k, (f = new Intl.DateTimeFormat(undefined, o))); return f.format(t); };
  let lastX = -99;
  const label = (x, txt, strong) => { if (x - lastX > ctx.measureText(txt).width * 0.5 + 18 && x + 3 + ctx.measureText(txt).width <= W) { ctx.fillStyle = strong ? "#b6c6d8" : "#6f8499"; ctx.fillText(txt, x + 3, H - 2); lastX = x + ctx.measureText(txt).width; } };
  if (pxDay >= 14) {
    // single days: a tick and the date for each, weekends shaded, month names where a month starts
    for (let t = dayStart(V0); t <= V1 + DAY; t = dayStart(t + DAY * 1.5)) {
      const x = X(t), dd = new Date(t), first = dd.getDate() === 1, wk = dd.getDay() === 0 || dd.getDay() === 6;
      if (wk) { ctx.fillStyle = "rgba(255,255,255,.025)"; ctx.fillRect(x, tT, pxDay, tB - tT); }
      ctx.fillStyle = first ? "rgba(225,237,245,.3)" : "rgba(225,237,245,.1)"; ctx.fillRect(Math.round(x), first ? tT : tB - 4, 1, first ? tB - tT : 4);
      const txt = first ? fmt(t, { month: "short", day: "numeric" }) : pxDay >= 34 ? fmt(t, { weekday: "short", day: "numeric" }) : String(dd.getDate());
      label(x, txt, first);
    }
  } else if (pxDay >= 2.2) {
    // weeks: a tick per week, dated labels where there's room, month lines
    for (let t = weekStart(V0); t <= V1; t += WEEK) { const x = X(t); ctx.fillStyle = "rgba(225,237,245,.14)"; ctx.fillRect(Math.round(x), tB - 4, 1, 4); }
    const d = new Date(V0); d.setDate(1); d.setHours(0, 0, 0, 0);
    for (; d.getTime() <= V1; d.setMonth(d.getMonth() + 1)) { const x = X(d.getTime()); ctx.fillStyle = "rgba(225,237,245,.25)"; ctx.fillRect(Math.round(x), tT, 1, tB - tT); }
    const every = pxDay * 7 > 52 ? 1 : 2;
    let k = 0;
    for (let t = weekStart(V0); t <= V1; t += WEEK, k++) { if (k % every) continue; const dd = new Date(t); label(X(t), fmt(t, { month: "short", day: "numeric" }), dd.getDate() <= 7); }
  } else {
    ctx.fillStyle = "rgba(225,237,245,.12)";
    if (pxDay * 7 > 3) for (let t = weekStart(V0); t <= V1; t += WEEK) ctx.fillRect(Math.round(X(t)), tB - 3, 1, 3);
    const d = new Date(V0); d.setDate(1); d.setHours(0, 0, 0, 0);
    const months = []; while (d.getTime() <= V1) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
    const pxMonth = pxDay * 30.4;
    const every = pxMonth > 44 ? 1 : pxMonth > 22 ? 3 : pxMonth > 8 ? 6 : 12;
    for (const t of months) {
      if (t < V0) continue;
      const md = new Date(t), m = md.getMonth();
      if (m % every) continue;
      const x = X(t);
      ctx.fillStyle = "rgba(225,237,245,.22)"; ctx.fillRect(Math.round(x), tT, 1, tB - tT);
      label(x, m === 0 || every >= 12 ? String(md.getFullYear()) : fmt(t, { month: "short" }), m === 0);
    }
  }
  // zoomed in: where you are, and how to get back
  if (TL.v0 != null) {
    ctx.font = `600 9px ${getVar("--font-mono")}`; ctx.textAlign = "right";
    const span = Math.round((V1 - V0) / DAY);
    const txt = `${fmt(V0 + (V1 - V0) / 2, { month: "short", year: "numeric" }).toUpperCase()} · ${span} DAYS · DBL-CLICK TO FIT`;
    ctx.fillStyle = "rgba(4,7,13,.75)"; const tw = ctx.measureText(txt).width; ctx.fillRect(x1 - tw - 8, tT + 1, tw + 6, 12);
    ctx.fillStyle = "#9fe9ff"; ctx.fillText(txt, x1 - 4, tT + 10); ctx.textAlign = "left";
  }
  // today
  const xn = X(Date.now()); ctx.strokeStyle = "rgba(225,237,245,.45)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xn, tT); ctx.lineTo(xn, tB); ctx.stroke(); ctx.setLineDash([]);
  // markers: deadlines (red), milestones (amber), events (yellow)
  TL.hitMarks = [];
  if (TL.later && TL.later.length) {
    const x = x1 + 1, y = mT + 5;
    ctx.fillStyle = MARK_COL.due; ctx.font = `700 9px ${getVar("--font-mono")}`; ctx.textAlign = "right";
    ctx.fillText("›" + TL.later.length, x + 10, y + 3); ctx.textAlign = "left";
    TL.hitMarks.push({ x: x + 4, y, later: true });
  }
  for (const m of TL.marks) {
    if (m.t >= TL.t1) continue;
    const x = X(m.t), y = mT + 5, past = m.done || m.t < Date.now() - DAY;
    if (x < x0 - 5 || x > x1 + 5) continue;
    ctx.globalAlpha = past ? 0.4 : 1; ctx.fillStyle = MARK_COL[m.kind];
    ctx.beginPath();
    if (m.kind === "due") { ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y - 4); ctx.lineTo(x, y + 4); }
    else if (m.kind === "mile") { ctx.moveTo(x, y - 4.5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4.5); ctx.lineTo(x - 4, y); }
    else ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (m.kind === "due") { ctx.fillRect(x - 0.5, tT, 1, tB - tT); }
    ctx.globalAlpha = 1;
    TL.hitMarks.push({ x, y, m });
  }
  // in / out bars
  for (const [t, which] of [[a, "in"], [b, "out"]]) {
    const x = X(t), arm = TL.armed === which;
    ctx.fillStyle = arm ? "#38e1ff" : "#e1edf5";
    ctx.beginPath(); roundRect(ctx, x - 2.5, tT - 3, 5, tB - tT + 6, 2); ctx.fill();
    ctx.beginPath(); roundRect(ctx, which === "in" ? x : x - 7, tT - 3, 7, 4, 1.5); ctx.fill(); ctx.beginPath(); roundRect(ctx, which === "in" ? x : x - 7, tB - 1, 7, 4, 1.5); ctx.fill();
  }
  // playhead
  const xh = X(head);
  ctx.fillStyle = "#38e1ff"; ctx.fillRect(Math.round(xh) - 1, tT - 2, 2, tB - tT + 4);
  ctx.beginPath(); ctx.arc(xh, tT - 3, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // edges: little arrows when there's more of the timeline off to either side
  if (TL.v0 != null) {
    ctx.fillStyle = "rgba(159,233,255,.8)";
    if (V0 > TL.t0 + DAY / 2) { ctx.beginPath(); ctx.moveTo(2, (tT + tB) / 2); ctx.lineTo(8, (tT + tB) / 2 - 5); ctx.lineTo(8, (tT + tB) / 2 + 5); ctx.fill(); }
    if (V1 < TL.t1 - DAY / 2) { ctx.beginPath(); ctx.moveTo(W - 2, (tT + tB) / 2); ctx.lineTo(W - 8, (tT + tB) / 2 - 5); ctx.lineTo(W - 8, (tT + tB) / 2 + 5); ctx.fill(); }
  }
}
function syncTimelineUi() {
  const bar = $("#timeline"); if (!bar) return;
  const head = TL.head == null ? null : TL.head;
  $("#tl-date").textContent = head == null ? "Latest" : fmtDay(head);
  $("#tl-play").textContent = TL.playing ? "❚❚" : "▶";
  $("#tl-play").setAttribute("aria-label", TL.playing ? "Pause" : "Play the timeline");
  $("#tl-speed-l").textContent = TL_SPEEDS[TL.speed].label;
  bar.querySelectorAll("[data-crop]").forEach((b) => b.setAttribute("aria-pressed", String(!!TL.crop && TL.crop.mode === b.dataset.crop)));
  const hb = $("#tl-hidden");
  const parts = [];
  if (TL.crop && TL.hiddenCrop) parts.push(`${TL.hiddenCrop} hidden`);
  if (TL.hiddenFuture) parts.push(`${TL.hiddenFuture} not yet`);
  if (TL.crop && !TL.hiddenCrop) parts.unshift("Filter on · 0 hidden");
  hb.hidden = !parts.length;
  hb.textContent = parts.join(" · ") + (TL.crop ? " ✕" : "");
  hb.disabled = !TL.crop;
  hb.title = TL.crop ? "Clear the range filter and show everything" : "Items added after the playhead";
  const ob = $("#o-tlcrop");
  if (ob) { ob.hidden = !TL.crop; ob.textContent = `Timeline filter · ${TL.hiddenCrop} hidden`; ob.setAttribute("aria-pressed", "true"); }
  tlDraw();
}
function tlSetHead(t) {
  TL.head = t == null || t >= TL.t1 - DAY / 2 ? null : clamp(t, TL.t0, TL.t1);
  tlApply();
}
function tlPlay(on) {
  if (on) {
    const head = TL.head == null ? TL.t1 : TL.head;
    if (head >= tlOut() - DAY / 2 || head < tlIn()) TL.head = tlIn();
    TL.playing = true; TL.lastTs = 0;
    cancelAnimationFrame(TL.raf); TL.raf = requestAnimationFrame(tlTick);
  } else TL.playing = false;
  tlApply();
}
function tlTick(ts) {
  if (!TL.playing) return;
  const dt = TL.lastTs ? Math.min(100, ts - TL.lastTs) : 0; TL.lastTs = ts;
  const sp = TL_SPEEDS[TL.speed];
  let head = (TL.head == null ? TL.t1 : TL.head) + (dt / sp.ms) * sp.days * DAY;
  if (head >= tlOut()) { head = tlOut(); TL.playing = false; }
  TL.head = head >= TL.t1 - DAY / 2 ? null : head;
  if (TL.v0 != null) { const span = TL.v1 - TL.v0; if (head > TL.v1 - span * 0.1 || head < TL.v0) tlSetView(head - span * 0.25, head + span * 0.75); }
  tlApply();
  if (TL.playing) TL.raf = requestAnimationFrame(tlTick);
}
function tlSpeed(d) { TL.speed = clamp(TL.speed + d, 0, TL_SPEEDS.length - 1); syncTimelineUi(); }
function tlCrop(mode) {
  if (!mode || (TL.crop && TL.crop.mode === mode)) TL.crop = null;
  else TL.crop = { mode, a: tlIn(), b: tlOut() };
  store.set("tlCrop", TL.crop);
  if (TL.crop) toast(mode === "hide" ? "Hid everything between the in and out points. Clear it with the ✕ on the timeline or under View options." : "Kept only what's between the in and out points. Clear it with the ✕ on the timeline or under View options.");
  tlApply();
}
// in/out points snap to weeks, or to single days once you've zoomed in far enough to see them
const tlByDay = () => TL.cv && tlGeom().pxDay >= 8;
function tlSnapWeek(t) { return clamp(tlByDay() ? dayStart(t + DAY / 2) : weekStart(t + WEEK / 2), TL.t0, TL.t1); }
function tlSetIn(t) { const v = Math.min(tlSnapWeek(t), tlOut() - (tlByDay() ? DAY : WEEK)); TL.in = v <= TL.t0 ? null : v; store.set("tlIn", TL.in); }
function tlSetOut(t) { const v = Math.max(tlSnapWeek(t), tlIn() + (tlByDay() ? DAY : WEEK)); TL.out = v >= TL.t1 ? null : v; store.set("tlOut", TL.out); }
function tlHit(x, y) {
  const g = tlGeom(), touch = TL.lastPointer === "touch", r = touch ? 16 : 9;
  if (y <= g.tT + 1) for (const hm of TL.hitMarks || []) if (Math.abs(hm.x - x) < (hm.later ? 10 : 6) && Math.abs(hm.y - y) < 8) return hm.later ? { kind: "later" } : { kind: "mark", m: hm.m };
  const xi = g.X(tlIn()), xo = g.X(tlOut()), xh = g.X(TL.head == null ? TL.t1 : TL.head);
  const di = Math.abs(x - xi), dO = Math.abs(x - xo), dh = Math.abs(x - xh);
  if (dh < r && (y < g.tT + 6 || (dh <= di && dh <= dO))) return { kind: "head" };
  if (di < r && di <= dO) return { kind: "in" };
  if (dO < r) return { kind: "out" };
  return { kind: "track" };
}
function tlXY(e) { const r = TL.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function tlDown(e) {
  TL.lastPointer = e.pointerType;
  const { x, y } = tlXY(e), hit = tlHit(x, y), g = tlGeom();
  try { TL.cv.setPointerCapture(e.pointerId); } catch (_) {}
  TL.ptrs = TL.ptrs || new Map(); TL.ptrs.set(e.pointerId, { x, y });
  if (TL.ptrs.size === 2) {
    // two fingers: pinch to zoom, slide to pan (the first finger's playhead move is undone)
    const [p, q] = [...TL.ptrs.values()];
    if (TL.drag && TL.drag.head0 !== undefined) { TL.head = TL.drag.head0; tlApply(); }
    TL.drag = null;
    TL.pinch = { d: Math.abs(p.x - q.x) || 1, span: g.V1 - g.V0, tc: g.T((p.x + q.x) / 2) };
    TL.tip.hidden = true; return;
  }
  if (e.button === 1) { e.preventDefault(); TL.drag = { kind: "pan", x0: x, v0: g.V0, v1: g.V1, moved: false }; TL.cv.style.cursor = "grabbing"; return; }
  if (hit.kind === "later") { TL.drag = null; const m = TL.later[0]; if (m) { select(m.id); centerOn(m.id); pulse(m.id); } return; }
  if (hit.kind === "mark") { TL.drag = null; const id = hit.m.id; if (G.pulled) releasePull(true); select(id); centerOn(id); pulse(id); return; }
  if (hit.kind === "track" && TL.armed) { (TL.armed === "in" ? tlSetIn : tlSetOut)(g.T(x)); TL.armed = null; tlApply(); return; }
  if (TL.playing && hit.kind === "head") tlPlay(false);
  if (hit.kind === "track") TL.lastTrack = { t: performance.now(), head0: TL.head };
  TL.drag = { kind: hit.kind === "track" ? "head" : hit.kind, x0: x, moved: false, head0: TL.head };
  if (hit.kind === "track") tlSetHead(g.T(x));
}
function tlMove(e) {
  const { x, y } = tlXY(e), g = tlGeom();
  if (TL.ptrs && TL.ptrs.has(e.pointerId)) TL.ptrs.set(e.pointerId, { x, y });
  if (TL.pinch && TL.ptrs && TL.ptrs.size === 2) {
    const [p, q] = [...TL.ptrs.values()], d = Math.abs(p.x - q.x) || 1, mx = (p.x + q.x) / 2;
    const span = clamp(TL.pinch.span * TL.pinch.d / d, TL_MIN_SPAN, TL.t1 - TL.t0), r = (mx - g.x0) / (g.x1 - g.x0);
    tlSetView(TL.pinch.tc - r * span, TL.pinch.tc - r * span + span);
    return;
  }
  const D = TL.drag;
  if (D && D.kind === "pan") { const dt = -((x - D.x0) / (g.x1 - g.x0)) * (D.v1 - D.v0); tlSetView(D.v0 + dt, D.v1 + dt); return; }
  if (!D) {
    const hit = tlHit(x, y);
    TL.cv.style.cursor = hit.kind === "in" || hit.kind === "out" ? "ew-resize" : hit.kind === "mark" ? "pointer" : "pointer";
    const tip = TL.tip;
    if (hit.kind === "later") tip.textContent = "Later: " + TL.later.slice(0, 4).map((m) => `${m.kind === "due" ? "deadline" : m.kind === "mile" ? "milestone" : "event"} ${m.title} (${fmtDay(m.t)})`).join(" · ") + (TL.later.length > 4 ? ` · +${TL.later.length - 4} more` : "");
    else if (hit.kind === "mark") { tip.textContent = `${hit.m.kind === "due" ? "Deadline" : hit.m.kind === "mile" ? "Milestone" : "Event"} · ${hit.m.title} · ${fmtDay(hit.m.t)}`; }
    else if (hit.kind === "in" || hit.kind === "out") tip.textContent = `${hit.kind === "in" ? "In" : "Out"} point · ${fmtDay(hit.kind === "in" ? tlIn() : tlOut())} · drag, or click then click the track · double-click resets`;
    else tip.textContent = fmtDay(clamp(g.T(x), TL.t0, TL.t1));
    tip.hidden = false; const hw = tip.offsetWidth / 2 + 4; tip.style.left = clamp(x, hw, Math.max(hw, g.W - hw)) + "px";
    return;
  }
  if (Math.abs(x - D.x0) > 3) D.moved = true;
  if (D.kind === "head") tlSetHead(g.T(x));
  else if (D.moved) { (D.kind === "in" ? tlSetIn : tlSetOut)(g.T(x)); TL.armed = null; tlApply(); }
}
function tlUp(e) {
  if (e && TL.ptrs) TL.ptrs.delete(e.pointerId);
  if (TL.ptrs && TL.ptrs.size < 2) TL.pinch = null;
  if (TL.cv && TL.cv.style.cursor === "grabbing") TL.cv.style.cursor = "pointer";
  const D = TL.drag; TL.drag = null;
  if (D && (D.kind === "in" || D.kind === "out") && !D.moved) {
    TL.armed = TL.armed === D.kind ? null : D.kind; tlDraw();
    const which = TL.armed;
    if (which) setTimeout(() => { if (TL.armed === which) toast(`Click the timeline to place the ${which} point`); }, 320);
  }
}
function tlDbl(e) {
  const { x, y } = tlXY(e), hit = tlHit(x, y);
  // double-click on the track (its first click moved the playhead there): put the playhead back and zoom out to fit
  if (TL.lastTrack && performance.now() - TL.lastTrack.t < 600 && (hit.kind === "head" || hit.kind === "track")) {
    TL.head = TL.lastTrack.head0; TL.lastTrack = null; tlSetView(TL.t0, TL.t1); tlApply(); return;
  }
  if (hit.kind === "in") { TL.in = null; store.set("tlIn", null); }
  else if (hit.kind === "out") { TL.out = null; store.set("tlOut", null); }
  else if (hit.kind === "head") TL.head = null;
  else if (hit.kind === "track") { tlSetView(TL.t0, TL.t1); return; }   // double-click the track: zoom back out to the whole timeline
  else return;
  TL.armed = null; tlApply();
}
function tlKey(e) {
  const head = TL.head == null ? TL.t1 : TL.head;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); tlSetHead(head + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? WEEK : DAY)); }
  else if (e.key === "Home") { e.preventDefault(); tlSetHead(tlIn()); }
  else if (e.key === "End") { e.preventDefault(); tlSetHead(null); }
  else if (e.key === " ") { e.preventDefault(); tlPlay(!TL.playing); }
  else if (e.key === "i" || e.key === "I") { tlSetIn(head); tlApply(); }
  else if (e.key === "o" || e.key === "O") { tlSetOut(head); tlApply(); }
  else if (e.key === "+" || e.key === "=") { e.preventDefault(); tlZoomAt(head, 0.6); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); tlZoomAt(head, 1.65); }
  else if (e.key === "0") { e.preventDefault(); tlSetView(TL.t0, TL.t1); }
}
function tlToggle() { TL.show = !TL.show; store.set("tlShow", TL.show); $("#timeline").hidden = !TL.show; G.wrap.classList.toggle("has-tl", TL.show); syncControls(); tlDraw(); }

/* ---------- gesture control: camera hand tracking (MediaPipe Hands, runs on this device) ----------
   3D hand control of the node tree:
   - LEFT hand steers the tree's rotation: turn, tilt or twist your open hand and the tree turns, tilts and twists
     twice as far (10° of hand = 20° of tree). Close it into a fist to pause, reposition, open to carry on.
   - BOTH hands from fists to open = 2D Explode view; both from open to fists = back to 3D.
   - RIGHT hand holds the map like a ball: make a fist to grab it, then turn your fist or move it to rotate the
     sphere, and let go mid-move to set it spinning. With an open hand, spread or close your thumb and index finger
     to zoom in or out. */
const MP_VER = "0.4.1675469240";
// two mirrors of the same package: some networks block one of them
const MP_BASES = [`https://unpkg.com/@mediapipe/hands@${MP_VER}/`, `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VER}/`];
const GX = { on: false, hands: null, stream: null, video: null, busy: false, last: 0, lastSeen: 0, raf: 0, frameT: 0,
  L: null, R: null, spin: { yaw: 0, pitch: 0, roll: 0 }, engaged: false,
  TR: { yaw: 0, pitch: 0, roll: 0 }, CR: { yaw: 0, pitch: 0, roll: 0 }, base: null,
  T: null, Leng: null, pair: { state: "", since: 0, prev: "", prevSince: 0, last: 0 }, arr3: null };
const GX_GAIN = 2;   // the tree turns twice as far as the hand
// One Euro filter: very smooth when still, still responsive on fast moves
function oneEuro(minCut = 1, beta = 0.5, dCut = 1) {
  let x = null, dx = 0, tPrev = 0;
  const a = (cut, dt) => { const r = 2 * Math.PI * cut * dt; return r / (r + 1); };
  return (v, t) => {
    if (x == null) { x = v; tPrev = t; return v; }
    const dt = Math.max(1e-3, (t - tPrev) / 1000); tPrev = t;
    dx += a(dCut, dt) * ((v - x) / dt - dx);
    x += a(minCut + beta * Math.abs(dx), dt) * (v - x);
    return x;
  };
}
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// the hand's pose from its 21 landmarks: orientation (turn, tilt, twist), position, size, shape
// x and y are scaled to the camera's 4:3 frame so angles come out true; x is mirrored like a selfie view
function handPose(L, label, score) {
  const P = L.map((q) => ({ x: (1 - q.x) * 4 / 3, y: q.y, z: -(q.z || 0) * 4 / 3 }));   // z grows toward the camera
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }), len = (v) => Math.hypot(v.x, v.y, v.z) || 1e-6;
  const up = sub(P[9], P[0]), across0 = sub(P[17], P[5]);
  const across = across0.x < 0 ? { x: -across0.x, y: -across0.y, z: -across0.z } : across0;   // always pointing to screen-right
  const size = len(up);
  const ext = (tip, pip) => len(sub(P[tip], P[0])) > len(sub(P[pip], P[0])) * 1.12;
  const n = ext(8, 6) + ext(12, 10) + ext(16, 14) + ext(20, 18);
  return {
    label, score, size, n,
    fist: n === 0, open: n >= 3,
    // twist (roll): the palm's up-direction in the screen plane; turn (yaw) and tilt (pitch): how far its sides / top lean toward the camera
    roll: Math.atan2(up.x, -up.y),
    yaw: Math.atan2(across.z, Math.hypot(across.x, across.y)),
    pitch: Math.atan2(up.z, Math.hypot(up.x, up.y)),
    pos: { x: (P[0].x + P[5].x + P[9].x + P[17].x) / 4 / (4 / 3), y: (P[0].y + P[5].y + P[9].y + P[17].y) / 4 },
    aperture: len(sub(P[4], P[8])) / size,
  };
}
// which hand is which: MediaPipe's label (unmirrored camera) says "Right" for your left hand; fall back to position
function sides(res) {
  const lms = res.multiHandLandmarks || [], hd = res.multiHandedness || [];
  const hs = lms.map((L, i) => handPose(L, hd[i] && hd[i].label, hd[i] && hd[i].score != null ? hd[i].score : 1)).filter((h) => h.score >= 0.7);
  let left = hs.find((h) => h.label === "Right") || null, right = hs.find((h) => h.label === "Left") || null;
  if (hs.length === 2 && (!left || !right || left === right)) { const s2 = hs.slice().sort((a, b) => a.pos.x - b.pos.x); left = s2[0]; right = s2[1]; }
  return { left, right, count: hs.length };
}
function gxHandState() {
  // light filtering on the raw angles (the camera itself is eased at display rate, so this can stay responsive)
  const f = () => oneEuro(1.6, 1.4);
  return { f: { roll: f(), yaw: f(), pitch: f(), x: oneEuro(1.5, 1.5), y: oneEuro(1.5, 1.5), size: oneEuro(0.8, 0.8), ap: oneEuro(1.2, 1.2) }, prev: null, settle: 3, shapeN: 0, lastShape: null, vel: { yaw: 0, pitch: 0, roll: 0 }, mode: "", ang: null };
}
function gxReset(H) { const s = gxHandState(); Object.assign(H, s); }
function gxUi() {
  if ($("#gx-panel")) return;
  const panel = h("div", { class: "gx-panel hud", id: "gx-panel", hidden: "" },
    h("div", { class: "gx-head" }, h("span", { class: "gx-dot", id: "gx-dot" }), h("b", null, "Hand control"), h("button", { type: "button", class: "gx-x", "aria-label": "Turn hand control off", onclick: () => gxStop() }, "✕")),
    h("div", { class: "gx-view" }, h("video", { id: "gx-video", playsinline: "", muted: "", autoplay: "" }), h("canvas", { id: "gx-skel" })),
    h("p", { class: "gx-status", id: "gx-status" }, "Starting the camera…"),
    h("div", { class: "gx-hands" },
      h("div", { class: "gx-hand l" }, h("b", null, "Left hand · steer"), h("span", { id: "gx-l" }, "not seen")),
      h("div", { class: "gx-hand r" }, h("b", null, "Right hand · ball"), h("span", { id: "gx-r" }, "not seen"))),
    h("ul", { class: "gx-help" },
      h("li", null, h("b", { class: "c-l" }, "Left hand open"), " turn, tilt or twist your hand and the node tree turns twice as far (10° → 20°); the ground stays level. ", h("b", null, "Fist"), " pauses"),
      h("li", null, h("b", { class: "c-r" }, "Right fist"), " grab the map like a ball: turn or move your fist to rotate it, let go mid-move to spin it"),
      h("li", null, h("b", { class: "c-r" }, "Right hand open"), " spread thumb and index apart to zoom in, pinch them together to zoom out"),
      h("li", null, h("b", null, "Both fists → open"), " 2D Explode view · ", h("b", null, "both open → fists"), " back to 3D")),
    h("p", { class: "gx-note" }, "Video stays on this device; hand tracking runs in your browser."));
  G.wrap.append(panel);
  GX.video = $("#gx-video");
}
function gxStatus(t, state) { const s = $("#gx-status"); if (s && s.textContent !== t) s.textContent = t; const d = $("#gx-dot"); if (d) d.dataset.state = state || ""; }
function gxHandText(id, t) { const e = $(id); if (e && e.textContent !== t) e.textContent = t; }
// explain why the camera didn't start, and what the viewer can do about it
function gxWhyBlocked(e) {
  const pol = document.permissionsPolicy || document.featurePolicy;
  const frameBlocks = pol && typeof pol.allowsFeature === "function" && !pol.allowsFeature("camera");
  if (frameBlocks || (e && e.name === "SecurityError")) return "This page's frame on claude.ai doesn't allow the camera, so it can't be switched on from here. Use the camera copy of the map (ask Claude for it) and open it directly in Chrome or Edge.";
  if (e && e.name === "NotAllowedError") return "Camera access was refused. Click the camera or lock icon in the address bar, set Camera to Allow, and reload. On a Mac, also check System Settings → Privacy & Security → Camera and switch on your browser (or the Claude app).";
  if (e && e.name === "NotFoundError") return "No camera was found on this device.";
  if (e && e.name === "NotReadableError") return "The camera is busy in another app (a video call?). Close it and try again.";
  return "The camera couldn't start in this browser.";
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.crossOrigin = "anonymous"; s.onload = res; s.onerror = () => rej(new Error("load")); document.head.append(s); });
}
function gxBegin() {
  GX.L = gxHandState(); GX.R = gxHandState(); GX.spin = { yaw: 0, pitch: 0, roll: 0 }; GX.T = null; GX.Leng = null; G.treeAnim = null; gxRebase();
  if (G.dim !== 3) { setDim(3); toast("Hand control works in 3D, so the map switched to 3D"); }
  GX.raf = requestAnimationFrame(gxFrame);
}
async function gxStart() {
  gxUi();
  $("#gx-panel").hidden = false;
  GX.on = true; syncGestureBtn();
  const tok = (GX.session = (GX.session || 0) + 1);
  const stale = () => tok !== GX.session || !GX.on;
  gxStatus("Asking for the camera…", "wait");
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("no media"), { name: "NotSupportedError" });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
    if (stale()) { stream.getTracks().forEach((t) => t.stop()); return; }
    GX.stream = stream;
  } catch (e) {
    if (stale()) return;
    gxStatus(gxWhyBlocked(e), "err");
    GX.on = false; syncGestureBtn(); return;
  }
  GX.video.srcObject = GX.stream;
  try { await GX.video.play(); } catch (_) {}
  gxStatus("Loading hand tracking…", "wait");
  let ok = false;
  for (const base of MP_BASES) {
    try {
      if (!window.Hands) await loadScript(base + "hands.js");
      GX.hands = new window.Hands({ locateFile: (f) => base + f });
      GX.hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.65, minTrackingConfidence: 0.6, selfieMode: false });
      GX.hands.onResults(gxResults);
      if (GX.hands.initialize) await Promise.race([GX.hands.initialize(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000))]);
      if (stale()) { try { GX.hands && GX.hands.close && GX.hands.close(); } catch (_) {} GX.hands = null; return; }
      ok = true; break;
    } catch (e) {
      try { GX.hands && GX.hands.close && GX.hands.close(); } catch (_) {}
      GX.hands = null;
      delete window.Hands;   // that mirror couldn't serve it; try the other one
    }
  }
  if (!ok) {
    gxStatus("Hand tracking couldn't load: both unpkg.com and cdn.jsdelivr.net look blocked on this network. Try another network (e.g. a phone hotspot).", "err");
    gxStop(true); return;
  }
  gxStatus("Raise your hands to the camera", "ok");
  gxBegin();
  requestAnimationFrame(gxLoop);
}
async function gxLoop(ts) {
  if (!GX.on) return;
  if (!GX.busy && GX.video && GX.video.readyState >= 2 && ts - GX.last > 28) {
    GX.busy = true; GX.last = ts;
    try { await GX.hands.send({ image: GX.video }); } catch (_) {}
    GX.busy = false;
  }
  requestAnimationFrame(gxLoop);
}
function gxStop(keepMsg) {
  GX.on = false; GX.engaged = false; GX.base = null; GX.session = (GX.session || 0) + 1;
  resetTree(900);   // stand the tree back up when hand control ends
  if (GX.stream) { GX.stream.getTracks().forEach((t) => t.stop()); GX.stream = null; }
  if (GX.hands && GX.hands.close) { try { GX.hands.close(); } catch (_) {} }
  GX.hands = null;
  cancelAnimationFrame(GX.raf);
  if (!keepMsg && $("#gx-panel")) $("#gx-panel").hidden = true;
  syncGestureBtn(); kick();
}
function gxToggle() { if (GX.on) gxStop(); else gxStart(); }
function syncGestureBtn() { const b = $("#o-gesture"); if (b) b.setAttribute("aria-pressed", String(GX.on)); }
function drawSkeleton(res, S) {
  const cv = $("#gx-skel"); if (!cv) return;
  const W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
  if (cv.width !== W) { cv.width = W; cv.height = H; }
  const g = cv.getContext("2d"); g.clearRect(0, 0, W, H);
  const B = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const lms = res.multiHandLandmarks || [], hd = res.multiHandedness || [];
  lms.forEach((L, i) => {
    const isLeft = S.left && S.left.label === (hd[i] && hd[i].label) && (!S.right || S.right.label !== S.left.label) ? true : S.left && Math.abs(S.left.pos.x - (1 - (L[0].x + L[5].x + L[9].x + L[17].x) / 4)) < 1e-6;
    g.strokeStyle = isLeft ? "rgba(56,225,255,.95)" : "rgba(255,92,138,.95)"; g.lineWidth = 2;
    g.beginPath(); for (const [a, b] of B) { g.moveTo((1 - L[a].x) * W, L[a].y * H); g.lineTo((1 - L[b].x) * W, L[b].y * H); } g.stroke();
    g.font = "600 10px ui-monospace,monospace"; g.fillStyle = g.strokeStyle; g.fillText(isLeft ? "L · steer" : "R · ball", (1 - L[0].x) * W + 6, L[0].y * H + 4);
  });
}
// the hands set a target orientation / zoom; the camera glides to it at display rate (smooth even though tracking
// arrives at ~30 fps), and a released ball keeps spinning and slows down
// the hands turn the node tree (not the camera, so the ground stays the ground). Turns are measured in screen
// terms — left/right about the screen's vertical, toward/away about its horizontal, twist about the view axis — as
// an offset (GX.CR, eased toward the target GX.TR) on top of the tree's orientation when the gesture began
function gxSyncTarget() { GX.T = { k: G.cam.k }; }
function gxRebase() {
  if (GX.base) gxApply(GX.TR);
  GX.base = { M0: G.treeM ? G.treeM.slice() : M3.I(), C: M3.cam() };
  GX.TR = { yaw: 0, pitch: 0, roll: 0 }; GX.CR = { yaw: 0, pitch: 0, roll: 0 };
}
function gxApply(E) {
  const B = GX.base; if (!B) return;
  const V = M3.mul(M3.rz(E.roll), M3.mul(M3.rx(E.pitch), M3.ry(E.yaw)));
  setTreeM(M3.mul(M3.T(B.C), M3.mul(V, M3.mul(B.C, B.M0))));
}
function gxFrame(ts) {
  if (!GX.on) return;
  const dt = GX.frameT ? Math.min(50, ts - GX.frameT) : 16; GX.frameT = ts;
  if (!GX.T) gxSyncTarget();
  const s = GX.spin, speed = Math.abs(s.yaw) + Math.abs(s.pitch) + Math.abs(s.roll);
  if (speed > 0.002) {
    gxTurn(s.yaw * dt / 1000, s.pitch * dt / 1000, s.roll * dt / 1000);
    const k = Math.exp(-dt / 1100); s.yaw *= k; s.pitch *= k; s.roll *= k;
  }
  const c = G.cam, T = GX.T, A = GX.CR, Z = GX.TR;
  if (GX.engaged || speed > 0.002 || GX.easing) {
    const e = 1 - Math.exp(-dt / 75);   // ~75 ms time constant: smooth, but no rubbery lag
    const dy = Z.yaw - A.yaw, dp = Z.pitch - A.pitch, dr = Z.roll - A.roll, dk = Math.log(T.k / c.k);
    if (G.dim === 3) { A.yaw += dy * e; A.pitch += dp * e; A.roll += dr * e; gxApply(A); }
    if (Math.abs(dk) > 1e-4) zoomBy(Math.exp(dk * e));
    kick();
    GX.easing = Math.abs(dy) + Math.abs(dp) + Math.abs(dr) + Math.abs(dk) > 0.0015;
  } else {
    gxSyncTarget();   // the mouse and the rest of the app stay in charge when the hands aren't moving the map
    // if the camera was orbited with the mouse in the meantime, measure the next turn from the new view
    const C = M3.cam(), B = GX.base;
    if (!B || C.some((v, i) => Math.abs(v - B.C[i]) > 1e-4)) gxRebase();
  }
  GX.raf = requestAnimationFrame(gxFrame);
}
// turn the tree's target (and keep the left hand's anchor in step, so both hands and the spin add up)
function gxTurn(dy, dp, dr) {
  if (G.dim !== 3) return;
  const T = GX.TR;
  T.yaw += dy; T.pitch += dp; T.roll += dr;
  if (GX.Leng) { GX.Leng.c0.yaw += dy; GX.Leng.c0.pitch += dp; GX.Leng.c0.roll += dr; }
  GX.easing = true; kick();
}
// filtered pose deltas for one hand since its last frame (null on its first frames back)
function gxDeltas(H, pose, now) {
  const f = H.f, cur = { roll: f.roll(pose.roll, now), yaw: f.yaw(pose.yaw, now), pitch: f.pitch(pose.pitch, now), x: f.x(pose.pos.x, now), y: f.y(pose.pos.y, now), size: f.size(pose.size, now), ap: f.ap(pose.aperture, now) };
  H.ang = { roll: cur.roll, yaw: cur.yaw, pitch: cur.pitch };
  const shape = pose.fist ? "fist" : pose.open ? "open" : "other";
  H.shapeN = shape === H.lastShape ? H.shapeN + 1 : 0; H.lastShape = shape;
  if (H.settle > 0) { H.settle--; H.prev = { ...cur }; return null; }
  const p = H.prev; if (!p) { H.prev = { ...cur }; return null; }
  // dead-zones keep a resting hand still, but tiny movements are held back and add up rather than lost,
  // so a slow, deliberate turn still comes through 1:1
  const gate = (key, e, ang) => { const d = ang ? wrapA(cur[key] - p[key]) : cur[key] - p[key]; if (Math.abs(d) < e) return 0; p[key] = cur[key]; return d; };
  const out = { roll: gate("roll", 0.005, true), yaw: gate("yaw", 0.007, true), pitch: gate("pitch", 0.007, true), x: gate("x", 0.0015), y: gate("y", 0.0015),
    zoom: cur.size / p.size, ap: cur.ap / Math.max(0.05, p.ap), apNow: cur.ap, shape, stable: H.shapeN >= 4 };
  p.size = cur.size; p.ap = cur.ap;
  return out;
}
// one frame of tracking
function gxResults(res) {
  if (!GX.on || !GX.L) return;
  const now = performance.now();
  const S = sides(res);
  drawSkeleton(res, S);
  if (!S.left) { gxReset(GX.L); gxHandText("#gx-l", "not seen"); }
  if (!S.right) { if (GX.R.mode === "grab") gxRelease(); gxReset(GX.R); gxHandText("#gx-r", "not seen"); }
  if (!S.count) { GX.engaged = false; gxStatus("Raise your hands to the camera", "ok"); return; }
  GX.lastSeen = now;
  let active = false;
  // ---- both hands: fists → open = 2D Explode view, open → fists = back to 3D
  gxPair(S, now);
  // ---- left hand: open hand steers the tree's rotation (twice the hand's angle); fist = pause
  if (S.left) {
    const d = gxDeltas(GX.L, S.left, now);
    if (d && d.shape === "open" && d.stable !== false && G.dim === 3) {
      const a = GX.L.ang;
      if (!GX.Leng) GX.Leng = { h0: { ...a }, c0: { ...GX.TR } };
      const E = GX.Leng;
      // absolute: the tree's orientation = where it was when you opened your hand + 2 × how far the hand has turned since
      GX.TR.yaw = E.c0.yaw - GX_GAIN * wrapA(a.yaw - E.h0.yaw);
      GX.TR.pitch = E.c0.pitch + GX_GAIN * wrapA(a.pitch - E.h0.pitch);
      GX.TR.roll = E.c0.roll + GX_GAIN * wrapA(a.roll - E.h0.roll);
      GX.easing = true; active = true;
      gxHandText("#gx-l", "steering (×2)");
    } else {
      GX.Leng = null;
      gxHandText("#gx-l", G.dim !== 3 ? "2D view: make two fists from open hands to go back to 3D" : d && d.shape === "fist" ? "paused (fist)" : "open your hand to steer");
    }
  } else GX.Leng = null;
  // ---- right hand: a ball in your hand. Fist = grab and turn (let go mid-move to spin); open = finger pinch zoom
  if (S.right) {
    const H = GX.R, d = gxDeltas(H, S.right, now);
    if (d) {
      if (d.shape === "fist") {
        if (H.mode !== "grab") { H.mode = "grab"; GX.spin = { yaw: 0, pitch: 0, roll: 0 }; H.vel = { yaw: 0, pitch: 0, roll: 0 }; }
        // turning the fist turns the ball; moving it rolls the ball like a trackball under your palm
        const dy = -d.yaw * 1.2 + d.x * Math.PI * 1.4, dp = d.pitch * 1.2 - d.y * Math.PI * 1.1, dr = d.roll * 1.2;
        gxTurn(dy, dp, dr); GX.easing = true;
        const dtS = 1 / 30, a = 0.35;
        H.vel = { yaw: H.vel.yaw * (1 - a) + (dy / dtS) * a, pitch: H.vel.pitch * (1 - a) + (dp / dtS) * a, roll: H.vel.roll * (1 - a) + (dr / dtS) * a };
        active = true;
        gxHandText("#gx-r", "holding the ball: turn or move to rotate, open to let go");
      } else {
        if (H.mode === "grab") gxRelease();
        H.mode = "zoom";
        // thumb–index spread: apart = zoom in, together = zoom out (only once the hand shape has settled)
        if (d.stable && d.apNow > 0.22) {
          const z = Math.pow(d.ap, 1.3);
          if (Math.abs(Math.log(z)) > 0.012) { if (!GX.T) gxSyncTarget(); GX.T.k = clamp(GX.T.k * clamp(z, 0.9, 1.1), 0.04, G.dim === 3 ? 5 : 8); GX.easing = true; active = true; }
        }
        gxHandText("#gx-r", "spread thumb and index to zoom · fist to grab");
      }
    }
  }
  GX.engaged = active || !!GX.Leng || GX.R.mode === "grab";
  gxStatus(active ? "Moving the map" : "Tracking", "ok");
}
// both hands together: fists → open switches to the 2D Explode view, open → fists goes back to 3D
function gxPair(S, now) {
  const both = S.left && S.right;
  const st = !both ? "" : S.left.fist && S.right.fist ? "fists" : S.left.open && S.right.open ? "open" : "mixed";
  const P = GX.pair;
  if (st !== P.state) { P.prev = P.state; P.prevSince = P.since; P.state = st; P.since = now; P.fired = false; }
  // the new state has to hold for a moment, and the old one has to have been held before (not a flicker)
  const held = now - P.since > 180, before = P.since - P.prevSince > 300, recent = now - P.last > 1500;
  if (!held || !before || !recent || P.fired) return;
  const in3 = G.dim === 3 && G.arrange !== "explode";
  if (P.prev === "fists" && st === "open" && (G.dim !== 2 || G.arrange !== "explode")) {
    P.fired = true; P.last = now;
    GX.arr3 = G.arrange; GX.spin = { yaw: 0, pitch: 0, roll: 0 };
    if (G.dim !== 2) setDim(2);
    if (G.arrange !== "explode") setArrange("explode");
    toast("✊✊ → 🖐🖐  2D Explode view");
  } else if (P.prev === "open" && st === "fists" && !in3) {
    P.fired = true; P.last = now;
    if (G.arrange === "explode" && GX.arr3 && GX.arr3 !== "explode") setArrange(GX.arr3);
    if (G.dim !== 3) setDim(3);
    GX.T = null; GX.Leng = null; gxRebase();
    toast("🖐🖐 → ✊✊  back to 3D");
  }
}
function gxRelease() {
  const H = GX.R; H.mode = "";
  const v = H.vel, sp = Math.abs(v.yaw) + Math.abs(v.pitch) + Math.abs(v.roll);
  if (sp > 0.9) { GX.spin = { yaw: clamp(v.yaw * 0.7, -3, 3), pitch: clamp(v.pitch * 0.7, -3, 3), roll: clamp(v.roll * 0.7, -3, 3) }; gxHandText("#gx-r", "spinning · grab again to stop"); }
}

/* ---------- add / remove nodes from the map ---------- */
function addKinds(gn) {
  if (!gn) return [];
  if ((gn.kind === "core" || gn.kind === "group") && st.canAdmin) return [["cat", "Category"]];
  if (gn.kind === "cat" && st.writer) return [["topic", "Topic"]];
  if (gn.kind === "note" && st.writer) {
    const n = st.notes.get(gn.id), out = [["sub", "Sub-topic"]];
    if (canModify(n)) out.push(["post", "Post link"]);
    return out;
  }
  return [];
}
function canRemoveNode(gn) {
  if (!gn) return false;
  if (gn.kind === "note") return canModify(st.notes.get(gn.id));
  if (gn.kind === "post") return canModify(st.notes.get(gn.parentId));
  if (gn.kind === "cat") return st.canAdmin && gn.ck !== "_none";
  return false;
}
function addBtn(id) {
  const gn = nodeData(id);
  return addKinds(gn).length ? h("button", { class: "btn small ghost", title: "Add a node under this one", onclick: () => { G.adding = G.adding === id ? null : id; G.renaming = G.leveling = null; refreshPreview(); } }, "+ Add") : null;
}
function removeBtn(id) {
  const gn = nodeData(id);
  if (!canRemoveNode(gn)) return null;
  const b = h("button", { class: "btn small ghost danger", title: "Remove this node" }, "Remove");
  b.onclick = () => {
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm"); b.textContent = "Tap again to remove";
      setTimeout(() => { if (b.isConnected) { b.classList.remove("confirm"); b.textContent = "Remove"; } }, 4000);
      return;
    }
    removeNode(id);
  };
  return b;
}
function addForm(gn) {
  const kinds = addKinds(gn);
  let kind = kinds[0][0];
  const groupSel = gn.kind === "core" ? h("select", { "aria-label": "Group" }, GROUP_ORDER.map((g) => h("option", { value: g }, groupLabel(g)))) : null;
  const nm = h("input", { type: "text", maxlength: "120", "aria-label": "Name" });
  const desc = h("input", { type: "text", maxlength: "160", placeholder: "What is it? (optional)", "aria-label": "Description", hidden: "" });
  const help = h("span", { class: "helper" });
  const setKind = (k) => {
    kind = k;
    nm.placeholder = k === "post" ? "https://www.instagram.com/p/…" : k === "cat" ? "Category name" : k === "topic" ? "Topic title" : "Sub-topic title";
    nm.type = k === "post" ? "url" : "text";
    desc.hidden = k !== "post";
    help.textContent = k === "cat" ? (gn.kind === "group" ? `New category in ${groupLabel(gn.grp)}` : "New category in the chosen group")
      : k === "topic" ? `New topic in ${gn.title}` : k === "sub" ? `New sub-topic under ${short(gn.title, 40)}` : "Adds a saved post to this topic";
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
  };
  const seg = h("div", { class: "seg small" }, kinds.map(([k, label]) => h("button", { type: "button", "data-k": k, onclick: () => { setKind(k); nm.focus(); } }, label)));
  const go = () => {
    const v = nm.value.trim();
    if (!v) { nm.focus(); return; }
    if (kind === "post" && !/^https?:\/\/\S+$/.test(v)) { help.textContent = "Paste a full link starting with https://"; nm.focus(); return; }
    G.adding = null;
    addNode(gn, kind, v, desc.value.trim(), groupSel ? groupSel.value : null);
  };
  const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } else if (e.key === "Escape") { e.stopPropagation(); G.adding = null; refreshPreview(); } };
  nm.onkeydown = onKey; desc.onkeydown = onKey;
  const form = h("div", { class: "pv-rename pv-add" },
    kinds.length > 1 ? seg : null, groupSel, nm, desc, help,
    h("div", { class: "pv-actions" }, h("button", { class: "btn small primary", onclick: go }, "Add"), h("button", { class: "btn small ghost", onclick: () => { G.adding = null; refreshPreview(); } }, "Cancel")));
  setKind(kind);
  setTimeout(() => nm.focus(), 30);
  return form;
}
function addNode(gn, kind, value, desc, grp) {
  histLabel(`Add "${short(value, 28)}"`);
  if (kind === "cat") {
    const list = cats().slice();
    const used = new Set(list.map((c) => c.color % NCOL));
    let color = 0; while (used.has(color) && color < NCOL - 1) color++;
    const id = "c" + Date.now().toString(36);
    store.set("newCats", [...store.get("newCats", []), id].slice(-20));
    saveCats([...list, { id, name: value.slice(0, 60), color, group: gn.kind === "group" ? gn.grp : grp || "General" }]);
    toast(`Added category "${short(value, 40)}"`);
    setTimeout(() => { showPreview("cat:" + id); pulse("cat:" + id); }, 400);
    return;
  }
  if (kind === "post") {
    const n = st.notes.get(gn.id); if (!n) return;
    const line = "- " + (desc || hostOf(value));
    putNote({ ...n, body: String(n.body || "").replace(/\s*$/, "") + "\n" + line + "\n" + value });
    toast("Added the post");
    setTimeout(() => { refreshPreview(); pulse(gn.id); }, 300);
    return;
  }
  const id = newId();
  const parent = kind === "sub" ? st.notes.get(gn.id) : null;
  const cat = parent ? parent.cat || "" : gn.ck === "_none" ? "" : gn.ck;
  putNote({ id, author: st.me, title: value, body: parent ? `Part of [[${parent.title}]]` : "", cat, links: [], created: Date.now() });
  toast(`Added "${short(value, 40)}"`);
  setTimeout(() => { select(id); pulse(id); }, 400);
}
function removeNode(id) {
  const gn = nodeData(id);
  if (!canRemoveNode(gn)) return;
  histLabel(`Remove "${short(gn.title || gn.name || "", 28)}"`);
  if (G.pulled) releasePull(true);
  if (gn.kind === "note") {
    const n = st.notes.get(id);
    const kids = (st.children.get(id) || []).length;
    hidePreview();
    removeNote(id);
    const mine = myAuthor();
    if (mine && (mine.edges || []).some((e) => e.a === id || e.b === id)) putMine({ edges: mine.edges.filter((e) => e.a !== id && e.b !== id) });
    toast(`Removed "${short(n.title, 40)}"` + (kids ? `. Its ${kids} sub-topic${kids > 1 ? "s" : ""} moved up to the category.` : ""));
  } else if (gn.kind === "post") {
    const n = st.notes.get(gn.parentId); if (!n) return;
    const lines = String(n.body || "").split("\n");
    const i = lines.findIndex((t) => t.trim() === gn.url || t.includes(gn.url));
    if (i < 0) { toast("Couldn't find that post in its topic"); return; }
    const own = lines[i].trim() === gn.url && i > 0 && /^[-*•]\s/.test(lines[i - 1].trim()) && !/https?:\/\//.test(lines[i - 1]);
    lines.splice(own ? i - 1 : i, own ? 2 : 1);
    const pn = { ...(n.postNames || {}) }; delete pn[gn.code];
    hidePreview();
    putNote({ ...n, body: lines.join("\n"), postNames: pn });
    toast("Removed the post");
  } else if (gn.kind === "cat") {
    const count = [...st.notes.values()].filter((n) => n.cat === gn.ck).length;
    hidePreview();
    store.set("newCats", store.get("newCats", []).filter((x) => x !== gn.ck));
    saveCats(cats().filter((c) => c.id !== gn.ck));
    toast(`Removed category "${short(gn.title, 40)}"` + (count ? `. Its ${count} notes are now Unsorted.` : ""));
  }
}
/* ---------- promote / demote: move a node one level up or down the hierarchy ---------- */
const PART_RE = /^Part of \[\[[^\]\n]+\]\][^\n]*\n?/m;
function setPartOf(body, title) {
  let b = String(body || "");
  if (PART_RE.test(b)) return title ? b.replace(PART_RE, `Part of [[${title}]]\n`) : b.replace(PART_RE, "").replace(/^\s*\n/, "");
  return title ? `Part of [[${title}]]\n\n` + b : b;
}
function noteDesc(id) {
  const out = new Set(), walk = (x) => { for (const k of st.children.get(x) || []) if (!out.has(k)) { out.add(k); walk(k); } };
  walk(id); return out;
}
function levelInfo(gn) {
  if (!gn) return null;
  if (gn.kind === "note") {
    const n = st.notes.get(gn.id); if (!n || !canModify(n)) return null;
    const par = n.parent ? st.notes.get(n.parent) : null, gp = par && par.parent ? st.notes.get(par.parent) : null;
    const up = par ? (gp ? `Move up under "${short(gp.title, 32)}"` : `Make it a topic of ${catName(n.cat)}`) : st.canAdmin ? "Make it a category of its own" : null;
    const desc = noteDesc(n.id);
    const down = [...st.notes.values()].filter((m) => m.id !== n.id && !desc.has(m.id) && (par ? m.parent === par.id : !m.parent && catKey(m) === catKey(n)))
      .sort((a, b) => postCount(b) - postCount(a) || a.title.localeCompare(b.title)).map((m) => ({ id: m.id, label: m.title }));
    return { kind: "note", now: par ? `Sub-topic of "${short(par.title, 32)}"` : `Topic in ${catName(n.cat)}`, up, down };
  }
  if (gn.kind === "cat" && st.canAdmin && gn.ck !== "_none") {
    const c = catById(gn.ck); if (!c) return null;
    const down = cats().filter((x) => x.id !== c.id && groupOf(x) === groupOf(c)).map((x) => ({ id: x.id, label: x.name }));
    return { kind: "cat", now: `Category in ${groupLabel(gn.grp)}`, up: null, upWhy: "Categories sit right under a main topic, so this is as high as it goes.", down };
  }
  return null;
}
function promoteNode(id) {
  const gn = nodeData(id), L = levelInfo(gn); if (!L || !L.up) return;
  histLabel(`Promote "${short(gn.title || "", 28)}"`);
  const n = st.notes.get(id);
  if (n.parent) {
    const par = st.notes.get(n.parent), gp = par && par.parent ? st.notes.get(par.parent) : null;
    putNote({ ...n, body: setPartOf(n.body, gp ? gp.title : null), cat: par ? par.cat : n.cat });
    toast(gp ? `Moved "${short(n.title, 30)}" up under "${short(gp.title, 30)}"` : `"${short(n.title, 30)}" is now a topic of ${catName(n.cat)}`);
  } else {
    // a top-level topic becomes its own category, keeping itself and everything under it inside
    const list = cats().slice(), used = new Set(list.map((c) => c.color % NCOL));
    let color = 0; while (used.has(color) && color < NCOL - 1) color++;
    const cid = "c" + Date.now().toString(36);
    const grp = groupOf(catById(n.cat) || { group: "General" });
    saveCats([...list, { id: cid, name: n.title.slice(0, 60), color, group: grp }]);
    for (const m of [n, ...[...noteDesc(id)].map((x) => st.notes.get(x)).filter(Boolean)]) putNote({ ...m, cat: cid });
    toast(`"${short(n.title, 30)}" is now a category in ${groupLabel(grp)}`);
    G.leveling = null; setTimeout(() => { showPreview("cat:" + cid); pulse("cat:" + cid); }, 450); return;
  }
  G.leveling = null; setTimeout(() => { pulse(id); refreshPreview(); }, 350);
}
function demoteNode(id, targetId) {
  const gn = nodeData(id), L = levelInfo(gn); if (!L || !targetId) return;
  histLabel(`Demote "${short(gn.title || "", 28)}"`);
  if (L.kind === "note") {
    const n = st.notes.get(id), t = st.notes.get(targetId); if (!t) return;
    putNote({ ...n, body: setPartOf(n.body, t.title), cat: t.cat });
    for (const x of noteDesc(id)) { const m = st.notes.get(x); if (m && m.cat !== t.cat) putNote({ ...m, cat: t.cat }); }
    toast(`"${short(n.title, 30)}" is now under "${short(t.title, 30)}"`);
    G.leveling = null; setTimeout(() => { pulse(id); refreshPreview(); }, 350); return;
  }
  // a category becomes a topic inside another category: its notes move across under one topic named after it
  const c = catById(gn.ck), d = catById(targetId); if (!c || !d) return;
  const inC = [...st.notes.values()].filter((m) => catKey(m) === c.id);
  let hub = inC.find((m) => !m.parent && squash(m.title).toLowerCase() === squash(c.name).toLowerCase());
  if (!hub) { hub = { id: newId(), author: st.me, title: c.name, body: c.title ? c.title : "", cat: d.id, links: [], created: Date.now() }; }
  putNote({ ...hub, cat: d.id, body: setPartOf(hub.body, null) });
  for (const m of inC) if (m.id !== hub.id) putNote({ ...m, cat: d.id, body: m.parent ? m.body : setPartOf(m.body, hub.title) });
  store.set("newCats", store.get("newCats", []).filter((x) => x !== c.id));
  saveCats(cats().filter((x) => x.id !== c.id));
  hidePreview();
  toast(`"${short(c.name, 30)}" is now a topic in ${d.name}`);
  const hid = hub.id; G.leveling = null; setTimeout(() => { if (st.notes.has(hid)) { select(hid); pulse(hid); } }, 500);
}
function pinBtn(id) {
  const n = G.byId.get(id); if (!n || n.kind === "core" || n.kind === "lens" || n.kind === "post" || inPulledGroup(id)) return null;
  return n.userPin ? h("button", { class: "btn small ghost", title: "Spring back to where it started", onclick: () => unpinNode(id) }, "📌 Unpin")
    : h("button", { class: "btn small ghost", title: "Keep this node where it is", onclick: () => pinNode(id) }, "📌 Pin");
}
function levelBtn(id) {
  return levelInfo(nodeData(id)) ? h("button", { class: "btn small ghost", title: "Promote or demote this node", onclick: () => { G.leveling = G.leveling === id ? null : id; G.adding = G.renaming = null; refreshPreview(); } }, "⇅ Level") : null;
}
function levelForm(gn) {
  const L = levelInfo(gn); if (!L) return null;
  const sel = L.down.length ? h("select", { "aria-label": "New parent" }, L.down.map((o) => h("option", { value: o.id }, short(o.label, 48)))) : null;
  return h("div", { class: "pv-rename pv-level" },
    h("span", { class: "helper" }, "Now: " + L.now),
    h("div", { class: "lv-row" },
      h("button", { class: "btn small" + (L.up ? "" : " ghost"), disabled: L.up ? null : "", title: L.up || L.upWhy || "", onclick: () => promoteNode(gn.id) }, "↑ Promote"),
      h("span", { class: "helper" }, L.up || L.upWhy || "Already at the top level")),
    h("div", { class: "lv-row" },
      h("button", { class: "btn small", disabled: sel ? null : "", onclick: () => sel && demoteNode(gn.id, sel.value) }, "↓ Demote"),
      sel ? h("span", { class: "helper" }, L.kind === "cat" ? "into category" : "under") : h("span", { class: "helper" }, "Nothing alongside it to go under"), sel),
    h("div", { class: "pv-actions" }, h("button", { class: "btn small ghost", onclick: () => { G.leveling = null; refreshPreview(); } }, "Close")));
}
function renameBtn(id) {
  const gn = nodeData(id);
  return canRename(gn) ? h("button", { class: "btn small ghost", title: "Edit name and title", onclick: () => { G.renaming = id; G.adding = null; refreshPreview(); } }, "Rename") : null;
}
const boxAppend = (box, ...xs) => box.append(...xs.flat().filter((x) => x != null && x !== false));
function refreshPreview() {
  const box = $("#preview");
  const id = G.selected;
  const gn = id && nodeData(id);
  if (gn && (G.renaming === id || G.adding === id || G.leveling === id) && !box.hidden && box.querySelector(".pv-rename")) { placePreview(); return; }
  if (G.adding && G.adding !== id) G.adding = null;
  if (G.leveling && G.leveling !== id) G.leveling = null;
  if (!gn || st.view !== "graph" || (st.mode === "note" && st.editing === id && G.W < 760)) { box.hidden = true; return; }
  box.replaceChildren();
  box.style.setProperty("--cc", gn.color);
  boxAppend(box, h("button", { class: "close", "aria-label": "Close preview", onclick: hidePreview }, "✕"), eyeBtn(id));
  const pl = pullLabel(id);
  const pullBtn = pl ? h("button", { class: "btn small" + (G.pulled && G.pulled.root === id ? " on" : ""), onclick: () => togglePull(id) }, pl) : null;
  if (gn.kind === "post") {
    const parent = st.notes.get(gn.parentId);
    const big = thumbEl(gn.code, G.W < 760 ? 168 : 336, "th hero");
    boxAppend(box, 
      h("div", { class: "pv-top" }, h("span", { class: "pill kind" }, "Source"), h("span", { class: "pill" }, srcLabel(gn.url))),
      big ? h("a", { class: "hero-a", href: gn.url, target: "_blank", rel: "noopener noreferrer" }, big) : null,
      h("h3", null, gn.title),
      gn.handle ? h("p", { class: "meta" }, "@" + gn.handle) : null,
      tagChips(gn.tags),
      gn.name ? h("p", { class: "pv-name" }, gn.name) : null,
      G.renaming === id ? renameForm(gn) : null,
      h("a", { class: "big-src", href: gn.url, target: "_blank", rel: "noopener noreferrer" }, `Open on ${srcLabel(gn.url)} ↗`),
      G.renaming === id ? null : h("div", { class: "pv-actions" }, renameBtn(id), removeBtn(id)),
      parent ? h("div", { class: "pv-top" }, h("span", { class: "mono-lbl" }, "From"), h("button", { type: "button", class: "cite", onclick: () => showPreview(parent.id) }, dot(parent.cat), short(parent.title, 40))) : null);
    box.hidden = false; placePreview(); return;
  }
  if (gn.kind !== "note") {
    const kids = gn.kind === "lens" && G.relate ? G.relate.top.map((x) => G.byId.get(x)).filter(Boolean) : G.nodes.filter((n) => n.tp === id);
    const ths = descPosts(gn, 12);
    const head = gn.full || gn.title;
    const meta = gn.kind === "lens" && G.relate ? `${G.relate.top.length} related topics · ${G.relate.posts.size} related posts${G.relate.ai ? " · refined by Claude" : ""}`
      : gn.kind === "core" ? `${st.notes.size} notes · ${G.posts.length} saved posts · ${G.nodes.filter((n) => n.kind === "group").length} groups`
      : gn.kind === "realm" ? realmStats(gn).toLowerCase() + " · saved inspiration, kept apart from the projects"
      : gn.kind === "group" ? groupStats(gn.grp).toLowerCase() : `${kids.length} topics · ${countPosts(gn)} posts`;
    boxAppend(box, 
      h("div", { class: "pv-top" }, h("span", { class: "pill kind" }, gn.kind === "core" ? "Core" : gn.kind === "realm" ? "Branch" : gn.kind === "group" ? "Group" : gn.kind === "cat" ? "Category" : "Related"), gn.kind === "cat" ? h("span", { class: "pill" }, gn.grp) : null),
      h("h3", null, head), gn.full && gn.full !== gn.title ? h("p", { class: "pv-name" }, gn.title) : null, h("p", { class: "meta" }, meta),
      G.renaming === id ? renameForm(gn) : null,
      ths.length ? mosaic(ths, 78) : null,
      kids.length ? h("span", { class: "mono-lbl" }, gn.kind === "core" ? "Branches and groups" : gn.kind === "realm" ? "Groups" : gn.kind === "group" ? "Categories" : "Topics") : null,
      kids.length ? h("div", { class: "pv-subs" }, kids.slice(0, 18).map((k) => h("button", { type: "button", class: "cite", onclick: () => (k.kind === "note" ? select(k.id) : showPreview(k.id)) }, h("span", { class: "dot", style: `background:${k.color}` }), short(k.title, 34)))) : null,
      G.adding === id ? addForm(gn) : null,
      G.leveling === id ? levelForm(gn) : null,
      h("div", { class: "pv-actions" }, pullBtn, gn.kind === "lens" ? h("button", { class: "btn small ghost", onclick: clearRelate }, "Clear") : null, G.renaming === id ? null : renameBtn(id), addBtn(id), levelBtn(id), pinBtn(id), removeBtn(id), h("button", { class: "btn small ghost", onclick: () => centerOn(id) }, "Centre")));
    box.hidden = false; placePreview(); return;
  }
  const n = st.notes.get(id);
  if (!n) { box.hidden = true; return; }
  const posts = G.posts.filter((p) => p.parentId === id);
  const kids = (st.children.get(n.id) || []).map((k) => st.notes.get(k)).filter(Boolean);
  const deg = (G.adj.get(n.id) || new Set()).size;
  const ths = descPosts(gn, 8);
  boxAppend(box, 
    h("div", { class: "pv-top" }, h("span", { class: "pill" }, dot(n.cat), catName(n.cat)), h("span", { class: "pill kind" }, kindOf(n)),
      n.parent && st.notes.get(n.parent) ? h("button", { type: "button", class: "cite", onclick: () => select(n.parent) }, "In: ", short(st.notes.get(n.parent).title, 28)) : null),
    h("h3", null, n.title || "Untitled"),
    n.name && n.name !== n.title ? h("p", { class: "pv-name" }, "On the map: " + n.name) : null,
    G.renaming === id ? renameForm(gn) : null,
    h("p", { class: "meta" }, [`by ${nameOf(n.author)}`, kids.length ? `${kids.length} sub-topics` : "", postCount(n) ? `${postCount(n)} sources` : "", deg ? `${deg} links` : ""].filter(Boolean).join(" · ")),
    ths.length ? mosaic(ths, 78) : null,
    excerpt(n, 240) ? h("p", { class: "pv-x" }, excerpt(n, 240)) : null,
    tagSummary(posts.length ? posts : G.posts.filter((p) => { let q = G.byId.get(p.parentId); while (q) { if (q.id === n.id) return true; q = G.byId.get(q.tp); } return false; })));
  if (kids.length) boxAppend(box, h("span", { class: "mono-lbl" }, "Sub-topics"), h("div", { class: "pv-subs" }, kids.sort((a, b) => postCount(b) - postCount(a)).map((k) => h("button", { type: "button", class: "cite", onclick: () => select(k.id) }, dot(k.cat), short(k.title, 34), h("span", { class: "meta" }, " " + postCount(k))))));
  const plist = posts.length ? posts : parsePosts(n.body).map((p) => ({ ...p, title: p.desc }));
  if (plist.length) {
    boxAppend(box, h("span", { class: "mono-lbl" }, "Sources"), h("div", { class: "pv-src" }, plist.slice(0, 4).map((p) =>
      h("a", { class: "src", href: p.url, target: "_blank", rel: "noopener noreferrer", style: `--cc:${gn.color}` },
        h("span", { class: "h" }, (p.handle ? "@" + p.handle + " · " : "") + srcLabel(p.url)), h("span", { class: "d" }, short(p.title || p.desc, 90)), tagChips(p.tags, true), h("span", { class: "go" }, "Open source ↗")))));
    if (plist.length > 4) boxAppend(box, h("p", { class: "meta" }, `+${plist.length - 4} more. Shake the node or use Pull out to see them all.`));
  }
  if (G.adding === id) boxAppend(box, addForm(gn));
  if (G.leveling === id) boxAppend(box, levelForm(gn));
  boxAppend(box, h("div", { class: "pv-actions" },
    h("button", { class: "btn small primary", onclick: () => openNote(n.id) }, "Open note"), pullBtn,
    G.renaming === id ? null : renameBtn(id), addBtn(id), levelBtn(id), pinBtn(id), removeBtn(id),
    h("button", { class: "btn small ghost", onclick: () => centerOn(n.id) }, "Centre")));
  box.hidden = false;
  placePreview();
}
function placePreview() {
  const box = $("#preview");
  if (box.hidden || !G.selected) return;
  if (G.W < 760) { box.style.transform = ""; return; }
  const gn = nodeData(G.selected);
  if (!gn || !gn._p) return;
  const p = gn._p;
  const bw = box.offsetWidth || 340, bh = box.offsetHeight || 300;
  const rr = (gn._hr || gn.r * p.s);
  let x = p.x + rr + 22, y = p.y - 60;
  if (x + bw > G.W - 60) x = p.x - rr - 22 - bw;
  x = clamp(x, 12, G.W - bw - 12); y = clamp(y, 140, Math.max(140, G.H - bh - 12));
  box.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}

/* ---------- relate: find everything connected to a goal or keyword ---------- */
const STOPW = new Set("i im i'm am looking look looks to make making made a an the with for and of in on how what show me my all nodes node related relate want wanting using use do does can could about is are that this it from into some any find get see like need should would which who where when why our we you your please give help".split(" "));
const GENERIC = new Set(["ai", "video", "videos", "image", "images", "new", "tool", "tools", "app", "3d", "create", "content"]);
const SYN = [
  ["robot", "robot,robots,robotic,robotics,humanoid,humanoids,unitree,galbot,gr00t,lerobot,exoskeleton,bionic,physical ai,figurelabs"],
  ["higgsfield", "higgsfield,seedance,genjutsu,higgsfield soul,supercomputer"],
  ["seedance", "seedance,higgsfield,dreamina,bytedance"],
  ["ai video", "seedance,kling,higgsfield,runway,veo,sora,luma,pika,hailuo,minimax,wan,ltx,dreamina,omnihuman,act-two,aleph,invideo"],
  ["ai film", "seedance,kling,higgsfield,runway,luma,ai short,ai film"],
  ["splat", "splat,splats,splatting,gaussian,3dgs,4dgs,radiance,supersplat"],
  ["gaussian", "splat,splats,splatting,gaussian,3dgs,4dgs,radiance"],
  ["mocap", "mocap,motion capture,markerless,move ai,metahuman,rokoko,posecap,xsens,vicon"],
  ["motion capture", "mocap,motion capture,markerless,metahuman,rokoko,posecap,xsens,vicon"],
  ["projection", "projection,projection mapping,projector,mapped"],
  ["hologram", "hologram,holographic,holobox,volumetric,holoportation"],
  ["claude", "claude,anthropic,opus,fable,mcp,claude code"],
  ["agent", "agent,agents,agentic,mcp,computer use,codex,astra"],
  ["blender", "blender,geometry nodes,cycles"],
  ["relight", "relight,relighting,beeble,aleph"],
  ["keying", "keying,green screen,greenscreen,matte,roto,rotoscoping,sam 3,segment"],
  ["green screen", "green screen,greenscreen,keying,matte,roto"],
  ["unreal", "unreal,ue5,ue 5,metahuman"],
  ["comfyui", "comfyui,comfy,wan,vace,flux"],
  ["nano banana", "nano banana,gemini"],
  ["led", "led,led wall,led screen,volume"],
  ["vr", "vr,ar,xr,quest,vision pro,ray-ban,mixed reality"],
  ["glasses", "glasses,ray-ban,vr,ar,xr"],
  ["houdini", "houdini,simulation,fluid"],
  ["virtual production", "virtual production,led wall,volume,ncam,stage"],
  ["face", "face swap,deepfake,avatar,identity"],
  ["3d model", "image-to-3d,trellis,hunyuan,tripo,rodin,mesh"],
];
function relTerms(q, extra) {
  const low = " " + String(q || "").toLowerCase().replace(/[^a-z0-9.+#'\s-]/g, " ").replace(/\s+/g, " ").trim() + " ";
  const raw = low.trim().split(" ").filter((w) => w && !STOPW.has(w));
  const terms = new Map();
  const add = (w, wt) => { w = w.trim(); if (!w || STOPW.has(w)) return; if ((terms.get(w) || 0) < wt) terms.set(w, wt); };
  for (const w of raw) { add(w, GENERIC.has(w) ? 0.6 : 2); if (w.length > 4 && w.endsWith("s")) add(w.slice(0, -1), GENERIC.has(w) ? 0.6 : 2); if (w.endsWith("ics")) add(w.slice(0, -3), 2); }
  const joined = " " + raw.join(" ") + " ";
  for (const [k, list] of SYN) {
    if (joined.includes(" " + k + " ") || joined.includes(" " + k + "s ") || (k.length > 4 && joined.includes(" " + k))) {
      for (const s of list.split(",")) add(s, GENERIC.has(s) ? 0.6 : 2);
      if (k.includes(" ")) for (const w of k.split(" ")) if (!list.split(",").includes(w)) terms.set(w, Math.min(terms.get(w) || 0.8, 0.8));
    }
  }
  for (const w of extra || []) add(String(w).toLowerCase(), 2);
  return terms;
}
const reCache = new Map();
function hitTerm(text, term) {
  if (term.length > 4 || term.includes(" ")) return text.includes(term);
  let re = reCache.get(term);
  if (!re) { re = new RegExp("(^|[^a-z0-9])" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)"); reCache.set(term, re); }
  return re.test(text);
}
function relate(q, extra, aiNotes) {
  const terms = relTerms(q, extra);
  if (!terms.size) return null;
  const strong = [...terms.values()].some((v) => v >= 2);
  const need = strong ? 2 : 1.2;
  const notes = new Map(), posts = new Set(), pscore = new Map();
  for (const p of G.posts) {
    // tools and the "about" tag count like the description; the kind of video / source only narrows a little
    const g = p.tags, tx = ((p.handle || "") + " " + (p.title || "") + (g ? " " + g.t.join(" ") + " " + g.a : "")).toLowerCase(), tk = g ? (g.f + " " + g.s).toLowerCase() : "";
    let s = 0;
    for (const [w, wt] of terms) if (hitTerm(tx, w)) s += wt; else if (tk && hitTerm(tk, w)) s += wt * 0.45;
    if (s >= need) { posts.add(p.id); pscore.set(p.id, s); notes.set(p.parentId, (notes.get(p.parentId) || 0) + s * 0.6); }
  }
  for (const n of G.nodes) {
    if (n.kind !== "note") continue;
    const note = st.notes.get(n.id);
    const title = String(n.title || "").toLowerCase(), ex = (note ? excerpt(note, 400) + " " + (String(note.body).match(/Key names:[^\n]*/) || [""])[0] : "").toLowerCase();
    let s = 0;
    for (const [w, wt] of terms) { if (hitTerm(title, w)) s += wt * 1.6; else if (hitTerm(ex, w)) s += wt * 0.7; }
    if (s >= need) notes.set(n.id, (notes.get(n.id) || 0) + s * 1.5);
  }
  for (const id of aiNotes || []) if (G.byId.has(id)) notes.set(id, (notes.get(id) || 0) + 6);
  const top = [...notes.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { q: String(q).trim(), terms, notes, posts, pscore, top, ai: !!(aiNotes && aiNotes.length) };
}
function computeLit(rel) {
  if (!rel || (!rel.notes.size && !rel.posts.size)) { G.lit = null; G.litPosts = null; return; }
  const lit = new Set();
  const up = (id) => { let n = G.byId.get(id); while (n && !lit.has(n.id)) { lit.add(n.id); n = G.byId.get(n.tp); } };
  for (const id of rel.notes.keys()) up(id);
  for (const pid of rel.posts) { const p = G.postById.get(pid); if (p) { lit.add(pid); up(p.parentId); } }
  if (G.byId.has("lens")) lit.add("lens");
  const was = G.lit && G.lit.size;
  G.lit = lit; G.litPosts = rel.posts;
  if (!was) G.waveT0 = performance.now() - WAVE_EVERY + 250;
}
async function commitRelate(q) {
  q = String(q || "").trim();
  if (!q) return;
  let rel = relate(q);
  G.relate = rel ? { ...rel, lens: true } : null;
  if (G.byId.get("lens")) G.byId.get("lens").userPlaced = false;
  if (!rel) { toast("Type a goal or topic, like \"AI video with Higgsfield\" or \"robotics\""); return; }
  renderGraph();
  showPreview("lens");
  syncQChip();
  if (!st.ai) return;
  const done = busy(`Finding everything related to "${short(q, 40)}"`);
  try {
    const list = G.nodes.filter((n) => n.kind === "note").map((n) => `${n.id} | ${squash(n.title)} | ${excerpt(st.notes.get(n.id) || {}, 120)}`).join("\n");
    const prompt = `A person is exploring their saved research (a graph of topics, each with saved Instagram posts). They typed: "${q}"

TOPICS (id | title | summary)
${list}

Pick the topics that would actually help with what they typed (tools, techniques, examples, related workflows), most useful first, at most 14. Also list up to 14 short lowercase keywords (tool names, techniques, synonyms) to find individual posts about it.

Reply with only JSON: {"notes":["<id>"],"keywords":["<keyword>"]}`;
    const res = await st.ai.json(prompt, { modelTier: "quick" });
    if (!G.relate || G.relate.q !== q) return;
    const kws = (res && Array.isArray(res.keywords) ? res.keywords : []).map((k) => String(k).toLowerCase().slice(0, 40)).filter((k) => k.length > 1).slice(0, 16);
    const ids = (res && Array.isArray(res.notes) ? res.notes : []).map(String).filter((id) => G.byId.has(id)).slice(0, 14);
    const r2 = relate(q, kws, ids);
    if (r2) { G.relate = { ...r2, lens: true }; renderGraph(); if (G.selected === "lens") refreshPreview(); }
  } catch (e) { const m = aiErr(e); if (m) toast(m, "err"); }
  finally { done(); }
}
function clearRelate() {
  if (G.pulled && G.pulled.root === "lens") releasePull(true);
  G.relate = null;
  st.query = ""; const q = $("#q"); if (q) q.value = "";
  if (G.selected === "lens") hidePreview();
  renderGraph(); applyHighlight(); syncQChip();
}
// after Enter, the search text turns into a chip: clicking it clears the search
function syncQChip() {
  const q = $("#q"); if (!q) return;
  const on = !!(G.relate && G.relate.lens && q.value.trim() && q.value.trim() === G.relate.q);
  q.classList.toggle("committed", on);
  q.title = on ? "Click to clear this search" : "";
  const hint = $("#q-hint"); if (on && hint) { hint.textContent = "click to clear ×"; hint.title = ""; }
}

/* ---------- status + controls ---------- */
function updateStatus() {
  const sb = $("#statusbar");
  if (!sb) return;
  const notes = G.nodes.filter((n) => n.kind === "note").length;
  const parts = [["Topics", notes], ["Posts", G.posts.length], ["Links", G.links.length], ["Mode", G.dim + "D"], ["Layout", G.layout], ["Zoom", G.cam.k.toFixed(2) + "×"]];
  if (G.pulled) parts.push(["Pulled", short((nodeData(G.pulled.root) || {}).title || "1", 22)]);
  sb.replaceChildren(...parts.map(([k, v]) => h("span", null, k + " ", h("b", null, String(v)))));
}
function syncControls() {
  $("#m-2d").setAttribute("aria-pressed", String(G.dim === 2));
  $("#m-3d").setAttribute("aria-pressed", String(G.dim === 3));
  $("#o-spin").hidden = G.dim !== 3 || reduceMotion;
  $("#o-spin").setAttribute("aria-pressed", String(G.spin));
  syncLabelUi();
  $("#o-rel").setAttribute("aria-pressed", String(G.showRel));
  $("#o-ai").setAttribute("aria-pressed", String(G.showAI));
  $("#o-posts").setAttribute("aria-pressed", String(G.showPosts));
  $("#o-thumbs").setAttribute("aria-pressed", String(G.showThumbs));
  if ($("#o-timeline")) $("#o-timeline").setAttribute("aria-pressed", String(TL.show));
  document.querySelectorAll(".seg [data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(G.arrange === "free" && b.dataset.layout === G.layout)));
  document.querySelectorAll(".seg [data-arr]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.arr === G.arrange)));
  updateStatus();
}
function setDim(d) {
  if (G.dim === d) return;
  { const prev = G.dim; histPush({ label: `${prev}D → ${d}D`, undo: () => setDim(prev), redo: () => setDim(d) }); }
  if (G.pulled) { setDimInFocus(d); return; }
  releasePull(true);
  G.dim = d; store.set("dim", d);
  for (const n of G.nodes) { n.z = d === 3 ? (Math.random() - 0.5) * 200 : 0; if (n.kind !== "core" && n.kind !== "lens") n.pin = false; }
  if (d === 3) { G.cam.yaw = 0.55; G.cam.pitch = -0.32; }
  syncControls();
  renderGraph();
}
// switching 2D/3D while a node is open keeps the opened tree on screen: the camera is matched so every opened
// node keeps its screen position, then the tree re-lays itself out for the new view
function setDimInFocus(d) {
  const P = G.pulled;
  const ids = [P.root, ...P.members, ...P.posts];
  const scr = new Map(ids.map((id) => { const n = nodeData(id); return [id, n && n._p ? { x: n._p.x, y: n._p.y } : null]; }));
  const c = G.cam, z2 = -DIST * 0.22;
  // keep the opened tree the same size on screen: solve the dolly scale at the focus plane for the matching k
  if (d === 3) { c.yaw = 0; c.pitch = 0; c.k = (c.k * DIST) / Math.max(1e-3, FOCAL - c.k * z2); }
  else c.k = pScale(z2, c.k);
  G.dim = d; store.set("dim", d);
  if (G.sig) G.sig = d + G.sig.slice(G.sig.indexOf("|"));
  const inG = new Set(ids);
  const rz = () => (d === 3 ? (Math.random() - 0.5) * 200 : 0);
  for (const n of G.nodes) if (!inG.has(n.id)) { n.z = rz(); if (n.kind !== "core" && n.kind !== "lens" && G.arrange === "free") n.pin = false; }
  for (const [, o] of P.orig) { o.z = rz(); if (G.arrange === "free") o.pin = false; }
  // put each opened node back exactly where it was on screen, in the new view's coordinates
  for (const [id, q] of scr) {
    const n = nodeData(id); if (!n || !q) continue;
    let w;
    if (d === 2) w = { x: (q.x - G.W / 2 - c.tx) / c.k, y: (q.y - G.H / 2 - c.ty) / c.k, z: 0 };
    else { setRot(); const s = pScale(z2, c.k); w = untree(unrot((q.x - G.W / 2 - c.tx) / s, (q.y - G.H / 2 - c.ty) / s, z2)); }
    G.anims = G.anims.filter((a) => a.n !== n);
    if (n.kind === "post") { n.x = w.x; n.y = w.y; n.z = w.z; } else { n.x = w.x; n.y = w.y; n.z = w.z; }
  }
  if (G.arrange !== "free") applyArrange(false);
  setRot();
  togglePull(P.root, true);
  if (d === 3) animateCam({ yaw: 0.22, pitch: -0.12 }, 900);
  G.alpha = Math.max(G.alpha, 0.35);
  syncControls(); kick();
}
function setLayout(l) {
  if (G.layout !== l || G.arrange !== "free") { const prev = G.layout, pa = G.arrange; histPush({ label: `Layout ${l}`, undo: () => { if (pa !== "free") setArrange(pa); else setLayout(prev); }, redo: () => setLayout(l) }); }
  if (G.arrange !== "free") { G.arrange = "free"; store.set("arrange", "free"); G.arrT = null; G.layout = null; }
  if (G.layout === l) return;
  releasePull(true);
  G.layout = l; store.set("layout", l);
  for (const n of G.nodes) if (n.kind !== "core" && n.kind !== "lens") n.pin = false;
  applyPins();
  G.alpha = 1;
  syncControls();
  G.fitAfter = performance.now() + (reduceMotion ? 0 : 1500);
  kick();
}
function resizeGraph() {
  const r = G.wrap.getBoundingClientRect();
  G.W = Math.max(1, r.width); G.H = Math.max(1, r.height); G.dpr = Math.min(2, window.devicePixelRatio || 1);
  G.cv.width = Math.round(G.W * G.dpr); G.cv.height = Math.round(G.H * G.dpr);
  if (G.bgCv) { G.bgCv.width = G.cv.width; G.bgCv.height = G.cv.height; }
  if (TL.cv) tlDraw();
  kick();
}
function initGraph() {
  G.cv = $("#graph"); G.ctx = G.cv.getContext("2d"); G.wrap = $("#wrap");
  G.bgCv = h("canvas", { id: "graph-bg", "aria-hidden": "true" }); G.cv.before(G.bgCv); G.bgCtx = G.bgCv.getContext("2d");
  G.focusBar = h("div", { class: "focusbar hud", id: "focusbar", hidden: "" }); G.wrap.append(G.focusBar);
  if (location.hostname === "localhost") window.__sb = { G, relate, st, select: (id) => select(id), showPreview: (id) => showPreview(id), togglePull: (id) => togglePull(id), releasePull: () => releasePull(), HX, histGo: (d) => histGo(d), kick: () => kick(), gx: { feed: (r) => gxResults(r), GX, start: () => { gxUi(); GX.on = true; gxBegin(); } } };
  readColors();
  resizeGraph();
  loadThumbs();
  if (window.ResizeObserver) new ResizeObserver(resizeGraph).observe(G.wrap);
  G.cv.addEventListener("pointerdown", onDown);
  G.cv.addEventListener("pointermove", onMove);
  G.cv.addEventListener("pointerup", onUp);
  G.cv.addEventListener("pointercancel", onUp);
  G.cv.addEventListener("pointerleave", () => { if (!G.drag && G.hover) { G.hover = null; G.cv.classList.remove("over"); hideHover(); kick(); } });
  G.cv.addEventListener("wheel", onWheel, { passive: false });
  G.cv.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
  G.cv.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  G.cv.addEventListener("contextmenu", (e) => e.preventDefault());
  G.cv.addEventListener("dblclick", (e) => { const pt = localXY(e); const n = hitTest(pt.x, pt.y); if (n && n.kind === "note") openNote(n.id); else if (n && n.kind === "post") window.open(n.url, "_blank", "noopener"); });
  $("#z-in").onclick = () => zoomBy(1.35);
  $("#z-out").onclick = () => zoomBy(1 / 1.35);
  $("#z-fit").onclick = () => { if (!GX.on) resetTree(); fitCamera(false); };
  $("#m-2d").onclick = () => setDim(2);
  $("#m-3d").onclick = () => setDim(3);
  document.querySelectorAll(".seg [data-layout]").forEach((b) => (b.onclick = () => setLayout(b.dataset.layout)));
  document.querySelectorAll(".seg [data-arr]").forEach((b) => (b.onclick = () => setArrange(b.dataset.arr)));
  $("#o-spin").onclick = () => { G.spin = !G.spin; store.set("spin", G.spin); syncControls(); kick(); };
  $("#b-undo").onclick = () => histGo(-1);
  $("#b-redo").onclick = () => histGo(1);
  document.addEventListener("keydown", (e) => {
    const typing = e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (typing || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); histGo(-1); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); histGo(1); }
  });
  syncHistUi();
  $("#o-rel").onclick = () => { G.showRel = !G.showRel; store.set("showRel", G.showRel); syncControls(); kick(); };
  $("#o-hidden").onclick = () => { const pop = $("#hidden-pop"); if (pop && !pop.hidden) pop.hidden = true; else renderHiddenPop(); };
  $("#o-lablvl").oninput = (e) => { G.labelAuto = false; G.labelLvl = +e.target.value; store.set("labAuto", false); store.set("labLvl", G.labelLvl); syncLabelUi(); kick(); };
  $("#o-labauto").onclick = () => { G.labelAuto = !G.labelAuto; if (!G.labelAuto) G.labelLvl = G.autoLvl; store.set("labAuto", G.labelAuto); store.set("labLvl", G.labelLvl); syncLabelUi(); kick(); };
  $("#o-ai").onclick = () => { G.showAI = !G.showAI; store.set("showAI", G.showAI); G.netCache = null; syncControls(); kick(); };
  $("#o-thumbs").onclick = () => { G.showThumbs = !G.showThumbs; store.set("thumbs", G.showThumbs); syncControls(); hideHover(); refreshPreview(); kick(); };
  $("#o-posts").onclick = () => { releasePull(true); G.showPosts = !G.showPosts; store.set("posts", G.showPosts); syncControls(); renderGraph(); };
  if (store.get("shook", false)) $("#shake-hint").hidden = true;
  tlInit();
  $("#o-timeline").onclick = tlToggle;
  $("#o-gesture").onclick = gxToggle;
  $("#o-tlcrop").onclick = () => tlCrop(null);
  // touch screens: dock the depth control under the zoom buttons
  if (COARSE && $(".zoomctl") && $("#netctl")) $(".zoomctl").append($("#netctl"));
  // small screens: fold the options panel away until asked
  const deck = $("#deck"), dt = $("#deck-tgl");
  if (deck && dt) {
    const small = matchMedia("(max-width: 760px)");
    const setDeck = (open) => { deck.classList.toggle("collapsed", !open); dt.setAttribute("aria-expanded", String(open)); dt.textContent = open ? "Hide options" : "View options"; };
    setDeck(!small.matches);
    dt.onclick = () => setDeck(deck.classList.contains("collapsed"));
    small.addEventListener && small.addEventListener("change", (m) => setDeck(!m.matches));
  }
  syncControls();
}

/* ---------- bridge to the app ---------- */
function renderGraph() {
  const vis = visibleNotes();
  const ids = new Set(vis.map((n) => n.id));
  const links = st.E.filter((e) => ids.has(e.a) && ids.has(e.b));
  const deg = new Map();
  for (const l of links) { deg.set(l.a, (deg.get(l.a) || 0) + 1); deg.set(l.b, (deg.get(l.b) || 0) + 1); }
  graphSetData(vis.map((n) => ({ id: n.id, title: n.title || "Untitled", name: n.name || "", pnames: n.postNames || null, ck: catKey(n), color: colorHex(n.cat), hub: isHub(n), r: nodeRadius(n, deg.get(n.id) || 0), parent: n.parent, posts: parsePosts(n.body),
    date: n.date || null, created: n.created || null, due: n.due || null, milestone: n.milestone || null, event: n.event || null, status: n.status || null })), links);
  applyHighlight();
  refreshPreview();
}
function nodeRadius(n, deg) {
  const p = postCount(n);
  if (isHub(n)) return 13 + Math.min(8, Math.sqrt((st.children.get(n.id) || []).length + p / 6) * 2);
  if (p) return 6 + Math.min(6, Math.sqrt(p) * 0.9);
  return 7 + Math.min(6, Math.sqrt(deg) * 2);
}
function visibleNotes() {
  const f = st.filter;
  return [...st.notes.values()].filter((n) => (!f.size || f.has(catKey(n))) && (!st.who || n.author === st.who));
}
function matches(n, q) { return (n.title + " " + n.body + " " + nameOf(n.author) + " " + catName(n.cat)).toLowerCase().includes(q); }
function applyHighlight() {
  const q = st.query.trim();
  let rel = null;
  if (st.cited && st.cited.size) rel = { notes: new Map([...st.cited].map((id) => [id, 1])), posts: new Set() };
  else if (q) rel = G.relate && G.relate.q === q ? G.relate : relate(q);
  computeLit(rel);
  G.focus = G.lit;
  if (st.selected && G.selected !== st.selected && (!G.selected || st.notes.has(G.selected))) G.selected = st.selected;
  if (!st.selected && G.selected && st.notes.has(G.selected)) G.selected = null;
  const hint = $("#q-hint");
  if (q && rel) { const nt = rel.notes.size, np = rel.posts.size; hint.textContent = nt || np ? `${nt} · ${np} ↵` : "none"; hint.title = `${nt} topics and ${np} posts match. Press Enter to relate.`; }
  else if (q) hint.textContent = "no matches";
  else hint.textContent = "/ to search";
  syncQChip();
  kick();
}
function pulse(id) { if (!reduceMotion) { G.pulses.push({ id, t0: performance.now() }); kick(); } }
function panTo(id) { if (st.view === "graph") centerOn(id); }
function fitAll(instant) { if (st.view === "graph") fitCamera(instant === true); }
