// Account menu for the Firebase version: who's signed in, sign out, and for the owner, the team list and data import.
const A = window.__sbAccount;
const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === "onclick") e.onclick = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const note = (t, err) => { const el = $("#acct-msg"); if (el) { el.textContent = t || ""; el.classList.toggle("err", !!err); } };

const btn = h("button", { class: "btn", id: "b-account", title: `Signed in as ${A.me.email}` }, h("span", { class: "acct-dot" }, (A.me.name || A.me.email)[0].toUpperCase()), h("span", { class: "t" }, A.me.name || "Account"));
(document.querySelector(".actions") || document.body).append(btn);
const panel = h("section", { class: "acct", id: "acct", hidden: true, role: "dialog", "aria-label": "Account" });
document.body.append(panel);
btn.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) render(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) panel.hidden = true; });

function render() {
  const owner = A.me.role === "owner";
  panel.replaceChildren(
    h("header", {}, h("strong", {}, "Account"), h("button", { class: "btn small ghost", onclick: () => (panel.hidden = true), "aria-label": "Close" }, "×")),
    h("p", { class: "acct-who" }, A.me.email, h("span", { class: "acct-role" }, A.me.role)),
    owner ? team() : null,
    owner ? importer() : null,
    h("p", { class: "acct-msg", id: "acct-msg" }),
    h("div", { class: "acct-foot" }, h("button", { class: "btn small", onclick: A.signOut }, "Sign out")),
  );
}

/* ---------- team list (owner only; the server rules enforce it too) ---------- */
function team() {
  const members = { ...((A.access() || {}).members || {}) };
  const rows = h("div", { class: "acct-rows" });
  const draw = () => {
    rows.replaceChildren(...Object.entries(members).sort((a, b) => a[0].localeCompare(b[0])).map(([em, m]) => {
      const role = h("select", { "aria-label": `Role for ${em}` }, ["member", "admin", "owner"].map((r) => { const o = h("option", { value: r }, r); if ((m.role || "member") === r) o.selected = true; return o; }));
      role.onchange = () => { members[em] = { ...members[em], role: role.value }; };
      const rm = h("button", { class: "btn small ghost danger", title: `Remove ${em}` }, "Remove");
      rm.onclick = () => { delete members[em]; draw(); };
      return h("div", { class: "acct-row" }, h("span", { class: "acct-em" }, em, m.name ? h("small", {}, " · " + m.name) : null), role, em === A.me.email ? h("span", { class: "acct-you" }, "you") : rm);
    }));
  };
  draw();
  const em = h("input", { type: "email", placeholder: "teammate@example.com", "aria-label": "Email to add" });
  const nm = h("input", { type: "text", placeholder: "Name (optional)", "aria-label": "Name" });
  const add = h("button", { class: "btn small" }, "Add");
  add.onclick = () => {
    const e = em.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { note("Enter a full email address.", true); return; }
    members[e] = { ...(members[e] || {}), role: (members[e] && members[e].role) || "member", ...(nm.value.trim() ? { name: nm.value.trim().slice(0, 60) } : {}) };
    em.value = nm.value = ""; note(""); draw();
  };
  const save = h("button", { class: "btn small primary" }, "Save team list");
  save.onclick = async () => {
    if (!Object.values(members).some((m) => m.role === "owner")) { note("Keep at least one owner.", true); return; }
    try { await A.setDoc(A.doc(A.fs, "config/access"), { members, updated: Date.now() }); note("Saved. People on the list can sign in now; anyone removed loses access at once."); }
    catch (e) { note("Couldn't save the list: " + (e.code || e.message), true); }
  };
  return h("div", { class: "acct-sec" }, h("h4", {}, "Who can sign in"), rows, h("div", { class: "acct-add" }, em, nm, add), save);
}

/* ---------- import a backup exported from the Claude version ---------- */
function importer() {
  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  const go = h("button", { class: "btn small" }, "Import backup…");
  go.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files && file.files[0]; file.value = "";
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { note("That file isn't a 2nd Brain backup.", true); return; }
    if (!data || data.kind !== "2nd-brain-backup" || !data.docs) { note("That file isn't a 2nd Brain backup.", true); return; }
    const paths = Object.keys(data.docs).filter((p) => /^(authors\/[^/]+(\/notes\/[^/]+)?|settings\/[^/]+)$/.test(p) && p !== "settings/lock");
    if (!confirm(`Import ${paths.length} documents${data.thumbs ? " and thumbnails" : ""}? Existing documents with the same ids are replaced.`)) return;
    go.disabled = true;
    try {
      for (let i = 0; i < paths.length; i += 100) {
        const b = A.writeBatch(A.fs);
        for (const p of paths.slice(i, i + 100)) b.set(A.doc(A.fs, p), data.docs[p]);
        await b.commit();
        note(`Imported ${Math.min(paths.length, i + 100)} of ${paths.length}…`);
      }
      if (data.thumbs && Array.isArray(data.thumbs.sheets)) {
        const sheetPaths = [];
        for (let k = 0; k < data.thumbs.sheets.length; k++) {
          const bin = Uint8Array.from(atob(data.thumbs.sheets[k]), (c) => c.charCodeAt(0));
          const path = `thumbs/s${k}.jpg`;
          await A.uploadBytes(A.sref(A.storage, path), bin, { contentType: "image/jpeg" });
          sheetPaths.push(path);
          note(`Uploaded thumbnail sheet ${k + 1} of ${data.thumbs.sheets.length}…`);
        }
        await A.setDoc(A.doc(A.fs, "settings/thumbs"), { t: data.thumbs.t, n: data.thumbs.n, m: data.thumbs.m || {}, sheets: sheetPaths });
      }
      note(`Done: ${paths.length} documents imported. Reload to see thumbnails.`);
    } catch (e) { note("Import stopped: " + (e.code || e.message), true); }
    finally { go.disabled = false; }
  };
  return h("div", { class: "acct-sec" }, h("h4", {}, "Data"), h("p", { class: "acct-help" }, "Load a backup exported from the Claude version of 2nd Brain."), go, file);
}
