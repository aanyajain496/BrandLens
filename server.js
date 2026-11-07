// BrandLens: pre-publication brand review. Zero runtime dependencies (Node 18+).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(process.env.DATA_DIR || os.tmpdir(), 'brandlens-data.json');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const uid = () => crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();

const USERS = {
  priya: { id: 'priya', name: 'Priya', role: 'creator' },
  marcus: { id: 'marcus', name: 'Marcus', role: 'manager' },
  dana: { id: 'dana', name: 'Dana', role: 'reviewer' },
};

// ---------- Seed: a fictional brand kit ("Nova" smart bottle) ----------
const SEED_SOURCES = [
  { id: 'G1', kind: 'guideline', title: 'Voice', body: 'Our voice is warm, calm and plain-spoken. We never pressure the reader.' },
  { id: 'G2', kind: 'guideline', title: 'Punctuation', body: 'No exclamation marks in headlines, and at most one in body copy.' },
  { id: 'G3', kind: 'guideline', title: 'Urgency', body: 'Never use urgency pressure such as "hurry", "last chance" or "act now".' },
  { id: 'G4', kind: 'guideline', title: 'Claims', body: 'Every number or performance claim must come from an approved fact. No superlatives or guarantees.' },
  { id: 'A1', kind: 'guideline', title: 'Accessibility: capitals', body: 'Avoid words in ALL CAPS because screen readers may spell them out letter by letter.' },
  { id: 'R1', kind: 'guideline', title: 'Readability', body: 'Keep sentences under 28 words.' },
  { id: 'F1', kind: 'fact', title: 'Hydration reminders', body: 'Nova reduces missed hydration reminders by up to 30% (2025 user study, 412 participants).' },
  { id: 'F2', kind: 'fact', title: 'Battery', body: 'Nova\'s battery lasts up to 14 days per charge.' },
  { id: 'F3', kind: 'fact', title: 'Materials', body: 'Nova is made from BPA-free stainless steel.' },
  { id: 'F4', kind: 'fact', title: 'Availability', body: 'Nova ships to India, the UK and the US only.' },
  { id: 'T1', kind: 'term', title: 'Product name', banned: 'gadget', preferred: 'smart bottle', body: 'Say "smart bottle", never "gadget".' },
  { id: 'T2', kind: 'term', title: 'Price wording', banned: 'cheap', preferred: 'affordable', body: 'Say "affordable", never "cheap".' },
];
const SAMPLE_DOCS = [
  { title: 'Nova launch post', content: 'Meet Nova, the world\'s fastest smart bottle!\nThis little GADGET is guaranteed to cut hydration mistakes by 100%. The battery lasts 30 days on a single charge, and it is cheap enough for everyone. Hurry, this offer won\'t last!!' },
  { title: 'Newsletter intro', content: 'Welcome back. This month we are sharing how Nova helps you remember to drink water. Nova reduces missed hydration reminders by up to 30% in our 2025 user study. Thanks for reading.' },
];

function seed() {
  const d = { sources: JSON.parse(JSON.stringify(SEED_SOURCES)), documents: [] };
  for (const s of SAMPLE_DOCS) d.documents.push(newDoc(s.title, s.content, 'priya'));
  return d;
}
function newDoc(title, content, author) {
  return { id: uid(), title, author, status: 'draft', createdAt: now(),
    versions: [{ n: 1, content, at: now(), findings: [], run: null }],
    events: [{ id: uid(), type: 'created', actor: USERS[author].name, role: USERS[author].role, note: '', at: now() }] };
}
let DB;
function load() { try { DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { DB = seed(); save(); } }
function save() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB)); } catch (e) { console.error('save failed', e.message); } }

// ---------- Review engine ----------
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

// The trust layer: a finding survives only if its excerpt is really in the content
// and its quote is really in the cited source. Nothing else is shown to the user.
function isGrounded(f, content, sources) {
  const src = sources.find(s => s.id === f.sourceId);
  return !!src && !!f.excerpt && !!f.sourceQuote && norm(src.body).includes(norm(f.sourceQuote)) && norm(content).includes(norm(f.excerpt));
}

function sentences(text) {
  const out = [], re = /[^.!?\n]+[.!?]*/g; let m;
  while ((m = re.exec(text))) { const t = m[0].trim(); if (t) out.push({ text: t, index: m.index + m[0].indexOf(t) }); }
  return out;
}
const unitOf = u => { u = u.toLowerCase(); return u === 'percent' ? '%' : u.replace(/s$/, ''); };
const NUM = /(\d+(?:\.\d+)?)\s?(%|percent|days?|hours?|weeks?|months?)/gi;
const SUPER = /world['’]?s (?:fastest|best|first)|best in the world|#1|number one|guarantee[ds]?|100%|risk-free/i;
const URGENT = /\b(hurry(?: up)?|last chance|act now|don['’]t miss out|limited time only)\b/i;
const CAPS_OK = new Set(['BPA', 'USB', 'FAQ', 'UK', 'US']);

function runRules(content, sources) {
  const out = [], flagged = new Set();
  const src = id => sources.find(s => s.id === id);
  const add = (o) => out.push({ id: uid(), status: 'open', origin: 'rule', sourceQuote: src(o.sourceId).body, ...o });
  const facts = sources.filter(s => s.kind === 'fact');
  const firstLineEnd = content.indexOf('\n') === -1 ? content.length : content.indexOf('\n');
  const sents = sentences(content);

  for (const t of sources.filter(s => s.kind === 'term' && s.banned)) {
    const m = content.match(new RegExp('\\b' + t.banned + '\\b', 'i'));
    if (m) add({ category: 'terminology', severity: 'low', excerpt: m[0], sourceId: t.id,
      why: `"${m[0]}" is not an approved term for this brand.`, suggestion: `Use "${t.preferred}".`, replacement: t.preferred });
  }
  sents.forEach((s, i) => {
    const words = s.text.split(/\s+/).length;
    const sup = s.text.match(SUPER);
    if (sup && src('G4')) {
      flagged.add(i);
      const fact = facts.find(f => /hydration|reminder/i.test(f.body) && /mistake|reminder|hydrat/i.test(s.text)) || null;
      add({ category: 'claim', severity: 'high', excerpt: s.text, sourceId: 'G4',
        why: `"${sup[0]}" is a superlative or guarantee, and none is in the approved facts.`,
        suggestion: fact ? `Stick to what is approved: "${fact.body}"` : 'Remove the superlative or guarantee, or ask for a new approved fact.',
        replacement: fact ? fact.body : null });
      return;
    }
    let numFlag = false;
    for (const m of s.text.matchAll(NUM)) {
      const unit = unitOf(m[2]);
      const related = facts.flatMap(f => [...f.body.matchAll(NUM)].filter(x => unitOf(x[2]) === unit).map(x => ({ f, x })));
      if (related.some(r => parseFloat(r.x[1]) === parseFloat(m[1]))) continue;
      numFlag = true; flagged.add(i);
      if (related.length) {
        const r = related[0];
        add({ category: 'claim', severity: 'high', excerpt: s.text, sourceId: r.f.id,
          why: `"${m[0]}" contradicts the approved fact, which says ${r.x[0]}.`,
          suggestion: `Change "${m[0]}" to "${r.x[0]}", as in the approved fact.`, replacement: s.text.replace(m[0], r.x[0]) });
      } else {
        add({ category: 'claim', severity: 'medium', excerpt: s.text, sourceId: 'G4',
          why: `"${m[0]}" is a number with no approved fact behind it.`, suggestion: 'Remove the number or add an approved fact for it.', replacement: null });
      }
      break;
    }
    if (numFlag) return;
    const u = s.text.match(URGENT);
    if (u) { flagged.add(i); add({ category: 'tone', severity: 'medium', excerpt: u[0], sourceId: 'G3',
      why: `"${u[0]}" puts pressure on the reader, which goes against our calm voice.`, suggestion: 'Remove the urgency phrase.', replacement: '' }); }
    if (words > 28) add({ category: 'accessibility', severity: 'low', excerpt: s.text, sourceId: 'R1',
      why: `This sentence has ${words} words; the limit is 28.`, suggestion: 'Split it into two shorter sentences.', replacement: null });
  });
  for (const w of new Set(content.match(/\b[A-Z]{4,}\b/g) || [])) {
    if (CAPS_OK.has(w)) continue;
    add({ category: 'accessibility', severity: 'low', excerpt: w, sourceId: 'A1',
      why: `"${w}" is in all capitals; screen readers may spell it out.`, suggestion: `Write "${w[0] + w.slice(1).toLowerCase()}".`, replacement: w[0] + w.slice(1).toLowerCase() });
  }
  // Exclamation marks (G2): headline never; body at most one. Skip sentences already flagged.
  let bodyBangs = 0;
  sents.forEach((s, i) => {
    if (!s.text.endsWith('!') && !s.text.includes('!')) return;
    const inHead = s.index < firstLineEnd;
    if (!inHead) bodyBangs++;
    if (flagged.has(i)) return;
    if (inHead || bodyBangs > 1) add({ category: 'tone', severity: inHead ? 'medium' : 'low', excerpt: s.text, sourceId: 'G2',
      why: inHead ? 'Headlines should not use exclamation marks.' : 'Body copy may use at most one exclamation mark.',
      suggestion: 'Use a full stop instead.', replacement: s.text.replace(/!+/g, '.') });
  });
  return out;
}

async function aiReview(content, sources) {
  const system = `You review marketing content against the brand sources provided. Only flag an issue if a source clearly supports it.
Return JSON only: {"findings":[{"category":"tone|terminology|claim|accessibility","severity":"high|medium|low","excerpt":"","why":"","sourceId":"","sourceQuote":"","suggestion":"","replacement":""}]}
"excerpt" must be copied exactly from the content. "sourceQuote" must be copied exactly from the cited source. "replacement" is the text to swap in for the excerpt (empty string to delete, null if unsure). Keep the writer's intent and change as little as possible. If nothing is wrong return {"findings":[]}.`;
  const user = 'SOURCES:\n' + sources.map(s => `[${s.id}] (${s.kind}) ${s.body}`).join('\n') + '\n\nCONTENT:\n' + content;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) throw new Error('AI service returned ' + r.status);
    const j = await r.json();
    return parseAiFindings((j.content || []).map(c => c.text || '').join(''));
  } finally { clearTimeout(timer); }
}
function parseAiFindings(text) {
  const m = String(text).replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI reply was not JSON');
  const arr = JSON.parse(m[0]).findings;
  if (!Array.isArray(arr)) throw new Error('AI reply had no findings list');
  const cats = ['tone', 'terminology', 'claim', 'accessibility'], sevs = ['high', 'medium', 'low'];
  return arr.filter(f => f && cats.includes(f.category) && sevs.includes(f.severity) && ['excerpt', 'why', 'sourceId', 'sourceQuote', 'suggestion'].every(k => typeof f[k] === 'string'))
    .map(f => ({ id: uid(), status: 'open', origin: 'ai', replacement: typeof f.replacement === 'string' ? f.replacement : null, ...f }));
}

async function reviewContent(content, sources, previous = []) {
  const run = { at: now(), mode: 'rules-only', model: null, dropped: 0, note: '' };
  let findings = runRules(content, sources);
  if (API_KEY) {
    try {
      const ai = await aiReview(content, sources);
      const good = ai.filter(f => isGrounded(f, content, sources));
      run.dropped = ai.length - good.length;
      for (const f of good) if (!findings.some(x => norm(x.excerpt).includes(norm(f.excerpt)) || norm(f.excerpt).includes(norm(x.excerpt)))) findings.push(f);
      run.mode = 'ai+rules'; run.model = MODEL;
    } catch (e) { run.note = 'AI review was unavailable (' + e.message + '). Showing rule-based checks only.'; }
  } else run.note = 'No AI key is configured, so only the rule-based checks ran.';
  findings = findings.filter(f => isGrounded(f, content, sources));
  const key = f => f.category + '|' + norm(f.excerpt);
  const dismissed = new Map(previous.filter(f => f.status === 'dismissed').map(f => [key(f), f]));
  findings = findings.map(f => dismissed.has(key(f)) ? { ...f, status: 'dismissed', dismissReason: dismissed.get(key(f)).dismissReason } : f);
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, run };
}

function applyReplacement(content, excerpt, replacement) {
  const i = content.indexOf(excerpt);
  if (i < 0) return null;
  return (content.slice(0, i) + replacement + content.slice(i + excerpt.length)).replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1');
}
// New version after a content change: keep findings whose text is still there, mark the rest resolved.
function carry(findings, content) {
  return findings.map(f => f.status === 'open' && !norm(content).includes(norm(f.excerpt)) ? { ...f, status: 'resolved' } : f);
}

// ---------- API ----------
const cur = d => d.versions[d.versions.length - 1];
const log = (d, u, type, note = '') => d.events.push({ id: uid(), type, actor: u.name, role: u.role, note, at: now() });
const summary = d => ({ id: d.id, title: d.title, status: d.status, author: USERS[d.author].name, version: cur(d).n,
  open: cur(d).findings.filter(f => f.status === 'open').length, updated: d.events[d.events.length - 1].at });
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (cond, code, msg) => { if (!cond) throw new HttpError(code, msg); };

async function route(req, user, body) {
  const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/^\/api\//, '').split('/'), m = req.method;
  if (p[0] === 'state' && m === 'GET') return { users: Object.values(USERS), docs: DB.documents.map(summary).reverse(),
    ai: API_KEY ? { on: true, model: MODEL } : { on: false } };
  if (p[0] === 'sources' && m === 'GET') return DB.sources;
  if (p[0] === 'sources' && m === 'POST') {
    need(user.role === 'manager', 403, 'Only a manager can edit the brand kit.');
    need(['guideline', 'fact', 'term'].includes(body.kind) && body.title && body.body, 400, 'Kind, title and text are required.');
    const s = { id: (body.kind === 'fact' ? 'F' : body.kind === 'term' ? 'T' : 'G') + (DB.sources.length + 1) + uid().slice(0, 2), kind: body.kind, title: body.title, body: body.body };
    if (body.kind === 'term' && body.banned) { s.banned = body.banned; s.preferred = body.preferred || ''; }
    DB.sources.push(s); save(); return s;
  }
  if (p[0] === 'reset' && m === 'POST') { DB = seed(); save(); return { ok: true }; }
  if (p[0] !== 'documents') throw new HttpError(404, 'Not found');
  if (!p[1] && m === 'POST') {
    need(user.role === 'creator', 403, 'Only creators can start a review.');
    need(body.title && body.title.trim() && body.content && body.content.trim(), 400, 'Please add a title and some text.');
    need(body.content.length <= 20000, 400, 'Text is too long for this demo (20,000 characters).');
    const d = newDoc(body.title.trim(), body.content, user.id); DB.documents.push(d); save(); return d;
  }
  const d = DB.documents.find(x => x.id === p[1]);
  need(d, 404, 'Document not found.');
  if (!p[2] && m === 'GET') return d;
  const editable = ['draft', 'changes_requested'].includes(d.status), v = cur(d);
  const act = p[2];
  if (act === 'review' && m === 'POST') {
    need(user.role === 'creator' && editable, 403, 'Only the creator can run a review while the document is editable.');
    const { findings, run } = await reviewContent(v.content, DB.sources, v.findings);
    v.findings = findings; v.run = run; log(d, user, 'review', `${findings.length} findings (${run.mode})`); save(); return d;
  }
  if (act === 'content' && m === 'POST') {
    need(user.role === 'creator' && editable, 403, 'The document is locked right now.');
    need(body.content && body.content.trim() && body.content.length <= 20000, 400, 'Text is empty or too long.');
    if (body.content !== v.content) { d.versions.push({ n: v.n + 1, content: body.content, at: now(), findings: carry(v.findings, body.content), run: v.run }); log(d, user, 'edit', 'Edited text'); }
    save(); return d;
  }
  if (act === 'findings' && m === 'POST') {
    need(user.role === 'creator' && editable, 403, 'Only the creator can resolve findings while the document is editable.');
    const f = v.findings.find(x => x.id === p[3]);
    need(f && f.status === 'open', 404, 'That finding is not open.');
    if (body.action === 'dismiss') {
      need(body.reason && body.reason.trim().length >= 3, 400, 'Please give a short reason for dismissing.');
      f.status = 'dismissed'; f.dismissReason = body.reason.trim(); log(d, user, 'dismiss', `${f.category}: ${f.dismissReason}`);
    } else if (body.action === 'accept' || body.action === 'edit') {
      const rep = body.action === 'edit' ? body.replacement : f.replacement;
      need(typeof rep === 'string' && (body.action === 'edit' || f.replacement !== null), 400, 'There is no automatic fix for this one. Use Edit to write your own.');
      const next = applyReplacement(v.content, f.excerpt, rep);
      need(next !== null, 409, 'That text is no longer in the document.');
      f.status = body.action === 'edit' ? 'edited' : 'accepted';
      d.versions.push({ n: v.n + 1, content: next, at: now(), findings: carry(v.findings, next), run: v.run });
      log(d, user, f.status, `${f.category}: "${f.excerpt.slice(0, 50)}"`);
    } else throw new HttpError(400, 'Unknown action.');
    save(); return d;
  }
  if (act === 'submit' && m === 'POST') {
    need(user.role === 'creator' && editable, 403, 'Only the creator can submit an editable document.');
    need(v.run, 400, 'Run a review before submitting.');
    d.status = 'in_review'; log(d, user, 'submit', `v${v.n} submitted, ${v.findings.filter(f => f.status === 'open').length} open findings`); save(); return d;
  }
  if (act === 'decision' && m === 'POST') {
    need(['manager', 'reviewer'].includes(user.role) && d.status === 'in_review', 403, 'Only a manager or reviewer can decide on a document in review.');
    const note = (body.note || '').trim(), openHigh = v.findings.filter(f => f.status === 'open' && f.severity === 'high').length;
    if (body.decision === 'approve') {
      if (openHigh) {
        need(user.role === 'manager', 403, `${openHigh} high-severity finding(s) are still open. Only a manager can approve over them, with a note.`);
        need(note.length >= 5, 400, 'Approving with open high-severity findings needs a note explaining why.');
      }
      d.status = 'approved'; log(d, user, openHigh ? 'approve_override' : 'approve', note);
    } else if (body.decision === 'changes') {
      need(note.length >= 3, 400, 'Please say what needs to change.');
      d.status = 'changes_requested'; log(d, user, 'changes', note);
    } else throw new HttpError(400, 'Unknown decision.');
    save(); return d;
  }
  if (act === 'comment' && m === 'POST') {
    need(body.note && body.note.trim(), 400, 'Write a comment first.'); log(d, user, 'comment', body.note.trim()); save(); return d;
  }
  throw new HttpError(404, 'Not found');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function createServer() {
  load();
  return http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.url.startsWith('/api/')) {
        const user = USERS[req.headers['x-user']];
        need(user, 401, 'Choose a demo user first.');
        let raw = ''; for await (const c of req) { raw += c; need(raw.length < 100000, 413, 'Request too large.'); }
        return send(200, await route(req, user, raw ? JSON.parse(raw) : {}));
      }
      const file = path.join(__dirname, 'public', req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
      if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
    } catch (e) { send(e.code || 500, { error: e.code ? e.message : 'Something went wrong on our side.' }); if (!e.code) console.error(e); }
  });
}
if (require.main === module) createServer().listen(PORT, () => console.log(`BrandLens on http://localhost:${PORT} (${API_KEY ? 'AI on: ' + MODEL : 'rules-only mode'})`));
module.exports = { runRules, isGrounded, parseAiFindings, applyReplacement, createServer, SEED_SOURCES };
