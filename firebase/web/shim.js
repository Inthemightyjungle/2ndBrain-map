// 2nd Brain on Firebase: a sign-in gate, then the same window.claude.use("db" | "user" | "sample") interface the app
// was written against, backed by Firestore, Firebase Auth and the `claude` Cloud Function. The app's code is unchanged.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { getStorage, ref as sref, getDownloadURL, uploadBytes } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const $ = (s) => document.querySelector(s);
const gate = $("#gate"), msg = $("#gate-msg");
const say = (t, err) => { msg.textContent = t || ""; msg.classList.toggle("err", !!err); };
const show = (id) => { for (const p of gate.querySelectorAll(".g-pane")) p.hidden = p.id !== id; };

// Firebase Hosting serves the project's web config here, so nothing needs pasting in
const cfg = await fetch("/__/firebase/init.json").then((r) => r.json()).catch(() => null);
if (!cfg) { show("g-wait"); say("Couldn't load the app's settings. Reload to try again.", true); throw new Error("no config"); }
const app = initializeApp(cfg);
const auth = getAuth(app);
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
const fns = getFunctions(app, "asia-southeast1");
const storage = getStorage(app);

/* ---------- sign-in ---------- */
const popupOrRedirect = async (provider) => {
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(e.code)) await signInWithRedirect(auth, provider);
    else throw e;
  }
};
const authErr = (e) => {
  const c = (e && e.code) || "";
  if (c === "auth/operation-not-allowed") return "That sign-in method isn't switched on for this app yet.";
  if (c === "auth/popup-closed-by-user") return "";
  if (c === "auth/unauthorized-domain") return "This web address isn't allowed to sign in. Add it under Authentication › Settings › Authorized domains.";
  if (c === "auth/invalid-email") return "That email address doesn't look right.";
  if (c === "auth/network-request-failed") return "No connection. Check your internet and try again.";
  return "Couldn't sign in. Try again.";
};
$("#g-google").onclick = () => { say(""); const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" }); popupOrRedirect(p).catch((e) => say(authErr(e), true)); };
$("#g-ms").onclick = () => { say(""); const p = new OAuthProvider("microsoft.com"); p.setCustomParameters({ prompt: "select_account" }); popupOrRedirect(p).catch((e) => say(authErr(e), true)); };
$("#g-email-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("#g-email").value.trim();
  if (!email) return;
  try {
    await sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
    localStorage.setItem("sb.signinEmail", email);
    say(`Check ${email} for a sign-in link. It works on this device only.`);
  } catch (err) { say(authErr(err), true); }
};
getRedirectResult(auth).catch((e) => say(authErr(e), true));
if (isSignInWithEmailLink(auth, location.href)) {
  let email = localStorage.getItem("sb.signinEmail");
  if (!email) email = prompt("Confirm your email to finish signing in") || "";
  signInWithEmailLink(auth, email, location.href)
    .then(() => { localStorage.removeItem("sb.signinEmail"); history.replaceState(null, "", location.pathname); })
    .catch((e) => say(authErr(e), true));
}
$("#g-out").onclick = () => signOut(auth).then(() => location.reload());

/* ---------- the runtime the app expects ---------- */
const code = (e) => String((e && e.code) || "").replace(/^(functions|firestore|storage)\//, "").replace(/-/g, "_");
const wrapErr = (e) => { const err = new Error((e && e.message) || "error"); err.code = code(e); return err; };
const docSnap = (s) => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });
function docApi(path) {
  const r = doc(fs, path);
  return {
    id: r.id, path,
    set: (d) => setDoc(r, d).catch((e) => { throw wrapErr(e); }),
    update: (d) => updateDoc(r, d).catch((e) => { throw wrapErr(e); }),
    delete: () => deleteDoc(r).catch((e) => { throw wrapErr(e); }),
    get: () => getDoc(r).then(docSnap, (e) => { throw wrapErr(e); }),
    collection: (p) => collApi(path + "/" + p),
    onSnapshot: (next, err) => onSnapshot(r, (s) => next(docSnap(s)), (e) => err && err(wrapErr(e))),
  };
}
function collApi(path) {
  const c = collection(fs, path);
  return {
    path,
    doc: (id) => docApi(id ? path + "/" + id : doc(c).path),
    onSnapshot: (next, err) => onSnapshot(c, (q) => next({ docs: q.docs.map(docSnap), size: q.size, empty: q.empty, metadata: q.metadata }), (e) => err && err(wrapErr(e))),
  };
}
const dbApi = { doc: docApi, collection: collApi };

let ACCESS = null, ME = null;
const callClaude = httpsCallable(fns, "claude", { timeout: 300000 });
function parseJson(t) {
  const s = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}"), a2 = s.indexOf("["), b2 = s.lastIndexOf("]");
  for (const [i, j] of [[a, b], [a2, b2]]) if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch {} }
  const err = new Error("Claude's reply wasn't valid JSON"); err.code = "invalid_json"; throw err;
}
function aiCode(e) {
  const c = code(e);
  if (c === "resource_exhausted") return "rate_limited";
  if (c === "permission_denied" || c === "unauthenticated") return "not_granted";
  if (c === "deadline_exceeded") return "timeout";
  return c || "failed";
}
async function sample(input, opts = {}) {
  const messages = typeof input === "string" ? [{ role: "user", content: input }] : input;
  if (opts.signal && opts.signal.aborted) { const e = new Error("cancelled"); e.code = "cancelled"; throw e; }
  const call = callClaude({ messages, tier: opts.modelTier || "default", json: !!opts._json, maxTokens: opts.maxTokens });
  const res = await new Promise((ok, no) => {
    const onAbort = () => { const e = new Error("cancelled"); e.code = "cancelled"; no(e); };
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });
    call.then(ok, (e) => { const err = new Error(e.message || "AI error"); err.code = aiCode(e); no(err); })
      .finally(() => opts.signal && opts.signal.removeEventListener("abort", onAbort));
  });
  const text = (res.data && res.data.text) || "";
  if (opts.onText) { try { opts.onText({ text, delta: text }); } catch {} }
  return { text, truncated: !!(res.data && res.data.truncated), modelApplied: res.data && res.data.model };
}
sample.json = async (input, opts = {}) => parseJson((await sample(input, { ...opts, _json: true })).text);
sample.limits = async () => ({ images: null, tools: false });

const userApi = {
  id: async () => ME.id,
  me: async () => ({ id: ME.id, name: ME.name, email: ME.email, isMe: true, guest: false }),
  isOwner: async () => ME.role === "owner",
  canEdit: async () => ME.role === "owner" || ME.role === "admin",
  can: async () => true,
  profiles: async (ids) => {
    const out = {};
    const members = (ACCESS && ACCESS.members) || {};
    for (const id of ids) {
      const hit = Object.entries(members).find(([em, m]) => (m.id || "") === id) || (id === ME.id ? [ME.email, ME] : null);
      out[id] = { id, name: hit ? hit[1].name || hit[0].split("@")[0] : "", avatarUrl: "", isMe: id === ME.id, guest: false };
    }
    return out;
  },
};

/* ---------- thumbnails: private in Storage, handed to the app before it starts ---------- */
async function loadThumbs() {
  try {
    const meta = await getDoc(doc(fs, "settings/thumbs"));
    if (!meta.exists()) return;
    const j = meta.data();
    const sheets = await Promise.all((j.sheets || []).map((p) => getDownloadURL(sref(storage, p)).catch(() => "")));
    window.__THUMBS = { t: j.t, n: j.n, m: j.m || {}, sheets };
  } catch {}
}

/* ---------- start ---------- */
let started = false;
onAuthStateChanged(auth, async (u) => {
  if (!u) { if (!started) { show("g-in"); gate.hidden = false; } return; }
  if (started) return;
  show("g-wait"); say("Checking your access…");
  if (!u.emailVerified) { show("g-no"); $("#g-no-msg").textContent = "Your email address isn't verified yet."; return; }
  try {
    const s = await getDoc(doc(fs, "config/access"));
    ACCESS = s.exists() ? s.data() : { members: {} };
  } catch (e) {
    show("g-no"); $("#g-who").textContent = u.email || "";
    $("#g-no-msg").textContent = code(e) === "permission_denied" ? "This account isn't on the 2nd Brain team list. Ask the owner to add you." : "Couldn't check your access. Reload to try again.";
    return;
  }
  const email = (u.email || "").toLowerCase();
  const m = (ACCESS.members || {})[email];
  if (!m) { show("g-no"); $("#g-who").textContent = u.email || ""; $("#g-no-msg").textContent = "This account isn't on the 2nd Brain team list. Ask the owner to add you."; return; }
  ME = { email, id: m.id || u.uid, role: m.role || "member", name: m.name || u.displayName || email.split("@")[0], uid: u.uid };
  onSnapshot(doc(fs, "config/access"), (s) => { if (s.exists()) ACCESS = s.data(); }, () => {});
  await loadThumbs();
  started = true;
  window.claude = { use: async (name) => (name === "db" ? dbApi : name === "user" ? userApi : name === "sample" ? sample : null) };
  window.__sbAccount = { auth, fs, storage, me: ME, access: () => ACCESS, signOut: () => signOut(auth).then(() => location.reload()), doc, setDoc, writeBatch, sref, uploadBytes };
  // start the app (its code ships inert until here)
  const src = document.getElementById("sb-app");
  const s2 = document.createElement("script"); s2.textContent = src.textContent; document.body.appendChild(s2);
  gate.hidden = true; document.body.classList.remove("gated");
  import("./account.js").catch(() => {});
});
