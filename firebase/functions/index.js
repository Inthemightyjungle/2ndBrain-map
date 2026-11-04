// 2nd Brain server functions.
// claude: lets signed-in team members use Claude (summaries, link filing, Ask, Recalibrate) without the page ever
// seeing the API key. The key lives in Secret Manager as ANTHROPIC_API_KEY and is only read here.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const API_KEY = defineSecret("ANTHROPIC_API_KEY");
// model per speed tier; change these in functions/.env if you want different models
const MODEL_QUICK = defineString("MODEL_QUICK", { default: "claude-haiku-5-5" });
const MODEL_DEFAULT = defineString("MODEL_DEFAULT", { default: "claude-sonnet-5-5" });
const MODEL_COMPLEX = defineString("MODEL_COMPLEX", { default: "claude-opus-5-5" });
const DAILY_LIMIT = defineString("DAILY_LIMIT", { default: "400" });   // calls per person per day

const MAX_CHARS = 400000;   // total characters sent per call

async function memberOf(token) {
  const email = String((token && token.email) || "").toLowerCase();
  if (!email || token.email_verified !== true) return null;
  const snap = await db.doc("config/access").get();
  const members = (snap.exists && snap.data().members) || {};
  return members[email] ? { email, ...members[email] } : null;
}

// count today's calls for this person; refuse past the daily limit
async function countCall(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`usage/${uid}_${day}`);
  const limit = Math.max(1, parseInt(DAILY_LIMIT.value(), 10) || 400);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const n = (s.exists ? s.data().n : 0) || 0;
    if (n >= limit) return false;
    tx.set(ref, { n: n + 1, uid, day, at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) throw new HttpsError("invalid-argument", "Bad messages.");
  let total = 0;
  const out = messages.map((m) => {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = String((m && m.content) || "");
    total += content.length;
    return { role, content };
  });
  if (total > MAX_CHARS) throw new HttpsError("invalid-argument", "That's too much text to send at once.");
  if (out[out.length - 1].role !== "user") throw new HttpsError("invalid-argument", "The last message must be from the user.");
  return out;
}

exports.claude = onCall(
  { region: "asia-southeast1", secrets: [API_KEY], timeoutSeconds: 300, memory: "256MiB", maxInstances: 10, concurrency: 20 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const who = await memberOf(req.auth.token);
    if (!who) throw new HttpsError("permission-denied", "Your account isn't on the 2nd Brain team list.");
    const d = req.data || {};
    const messages = cleanMessages(d.messages);
    const tier = ["quick", "default", "complex"].includes(d.tier) ? d.tier : "default";
    const model = tier === "quick" ? MODEL_QUICK.value() : tier === "complex" ? MODEL_COMPLEX.value() : MODEL_DEFAULT.value();
    const maxTokens = Math.min(16000, Math.max(256, parseInt(d.maxTokens, 10) || (tier === "quick" ? 4096 : 8192)));
    if (!(await countCall(req.auth.uid))) throw new HttpsError("resource-exhausted", "Daily AI limit reached. It resets at midnight UTC.");

    const system = d.json
      ? "Reply with only valid JSON exactly in the shape asked for. No prose, no code fences."
      : "You are the assistant inside 2nd Brain, a team's shared mind map. Follow the instructions in the user's message.";
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY.value(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      });
    } catch (e) {
      throw new HttpsError("unavailable", "Couldn't reach Claude. Try again.");
    }
    if (r.status === 429 || r.status === 529) throw new HttpsError("resource-exhausted", "Claude is busy or the account is out of credit. Try again shortly.");
    if (r.status === 401 || r.status === 403) throw new HttpsError("failed-precondition", "The Claude API key was refused. Check ANTHROPIC_API_KEY.");
    const body = await r.json().catch(() => null);
    if (!r.ok || !body) throw new HttpsError("internal", (body && body.error && body.error.message) || `Claude error ${r.status}`);
    const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    return { text, truncated: body.stop_reason === "max_tokens", model: body.model || model };
  }
);
