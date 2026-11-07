const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { user: localStorage.getItem('bl_user') || 'priya', users: [], docs: [], ai: {}, sources: [], view: 'home', doc: null, tab: 'review', sel: null, editing: false, busy: false };
const STATUS = { draft: 'Draft', in_review: 'In review', approved: 'Approved', changes_requested: 'Changes requested' };
const EVENT = { created: 'created the document', review: 'ran a review', edit: 'edited the text', accepted: 'accepted a suggestion', edited: 'applied their own fix',
  dismiss: 'dismissed a finding', submit: 'submitted for approval', approve: 'approved', approve_override: 'approved with open high-severity findings', changes: 'requested changes', comment: 'commented' };
const CAT = { tone: 'Tone', terminology: 'Terminology', claim: 'Claim', accessibility: 'Accessibility' };

function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3500); }
async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'content-type': 'application/json', 'x-user': S.user }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
async function run(fn, busyMsg) {
  if (S.busy) return;
  S.busy = busyMsg || true;
  const p = fn();                 // start first so form values are read before any redraw
  if (busyMsg) render();          // only show a banner for slow actions
  try { await p; } catch (e) { toast(e.message); S.busy = false; if (busyMsg) render(); return; }
  S.busy = false; render();
}
const me = () => S.users.find(u => u.id === S.user) || { role: 'creator', name: '' };
async function refresh() { Object.assign(S, await api('state')); if (S.doc) S.doc = await api('documents/' + S.doc.id); }
async function openDoc(id) { S.doc = await api('documents/' + id); S.view = 'doc'; S.tab = 'review'; S.sel = null; S.editing = false; }
const cur = () => S.doc.versions[S.doc.versions.length - 1];
const editable = () => ['draft', 'changes_requested'].includes(S.doc.status);

function highlighted(content, findings) {
  const marks = [];
  for (const f of findings.filter(f => f.status === 'open')) {
    const i = content.indexOf(f.excerpt);
    if (i >= 0 && !marks.some(m => i < m.end && i + f.excerpt.length > m.start)) marks.push({ start: i, end: i + f.excerpt.length, f });
  }
  marks.sort((a, b) => a.start - b.start);
  let out = '', pos = 0;
  for (const m of marks) {
    out += esc(content.slice(pos, m.start)) + `<mark class="${m.f.severity} ${S.sel === m.f.id ? 'sel' : ''}" data-act="sel" data-id="${m.f.id}" tabindex="0">${esc(content.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  return out + esc(content.slice(pos));
}

function findingCard(f, canAct) {
  const sources = S.sources, src = sources.find(s => s.id === f.sourceId);
  return `<div class="f-card ${S.sel === f.id ? 'sel' : ''}" data-act="sel" data-id="${f.id}">
    <div class="row"><span class="tag ${f.severity}">${f.severity}</span><strong>${CAT[f.category]}</strong>
      <span class="muted small">${f.origin === 'ai' ? 'AI-assisted' : 'Rule check'}</span></div>
    <p style="margin:.5em 0">${esc(f.why)}</p>
    <div class="src"><strong>${esc(f.sourceId)}${src ? ' · ' + esc(src.title) : ''}</strong><br>${esc(f.sourceQuote)}</div>
    <div class="sugg"><strong>Suggestion:</strong> ${esc(f.suggestion)}${f.replacement ? `<br><span class="small">Becomes: “${esc(f.replacement)}”</span>` : ''}</div>
    ${canAct ? `<div class="row">
      <button class="btn sm" data-act="accept" data-id="${f.id}" ${f.replacement === null ? 'disabled title="No automatic fix. Use Edit."' : ''}>Accept</button>
      <button class="btn sm ghost" data-act="edit" data-id="${f.id}">Edit</button>
      <button class="btn sm warn" data-act="dismiss" data-id="${f.id}">Dismiss</button></div>` : ''}</div>`;
}

function docView() {
  const d = S.doc, v = cur(), u = me(), isCreator = u.role === 'creator', canAct = isCreator && editable();
  const open = v.findings.filter(f => f.status === 'open'), done = v.findings.filter(f => f.status !== 'open');
  const high = open.filter(f => f.severity === 'high').length;
  let actions = '';
  if (canAct) actions = `<button class="btn ghost" data-act="editText">${S.editing ? 'Cancel editing' : 'Edit text'}</button>
    <button class="btn" data-act="review">${v.run ? 'Re-run review' : 'Run review'}</button>
    <button class="btn" data-act="submit" ${v.run ? '' : 'disabled title="Run a review first"'}>Submit for approval</button>`;
  const decide = ['manager', 'reviewer'].includes(u.role) && d.status === 'in_review' ? `<div class="card" style="margin-top:14px">
    <h3>Your decision</h3>${high ? `<p class="note">${high} high-severity finding(s) are still open. ${u.role === 'manager' ? 'You can approve over them, but a note is required.' : 'Only a manager can approve over them. You can request changes.'}</p>` : ''}
    <textarea id="decNote" style="min-height:70px" placeholder="Note (required to request changes or to approve over open high-severity findings)"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="approve" ${high && u.role !== 'manager' ? 'disabled' : ''}>Approve</button>
    <button class="btn warn" data-act="changes">Request changes</button></div></div>` : '';
  const roleNote = !canAct && isCreator ? `<p class="note">This document is ${STATUS[d.status].toLowerCase()}, so it is locked for editing.</p>` : (!isCreator && d.status !== 'in_review' ? `<p class="muted small">Switch to Priya (creator) to edit, or wait until this is submitted for approval.</p>` : '');
  const runNote = v.run ? `<div class="${v.run.note ? 'note' : 'muted small'}" style="${v.run.note ? '' : 'margin-bottom:10px'}">${v.run.mode === 'ai+rules' ? `AI-assisted review (${esc(v.run.model)}) plus rule checks. ${v.run.dropped ? `${v.run.dropped} AI flag(s) were dropped because they could not be matched to an approved source.` : 'Every AI flag was matched to an approved source.'}` : esc(v.run.note)}</div>` : '';
  const body = S.tab === 'review' ? `<div class="cols"><div class="card">
      ${S.editing ? `<textarea id="editBox" style="min-height:260px">${esc(v.content)}</textarea><div class="row" style="margin-top:8px"><button class="btn" data-act="saveText">Save as new version</button></div>`
        : `<div class="text">${highlighted(v.content, v.findings)}</div>`}
      ${roleNote}</div>
    <div>${runNote}${!v.run ? `<div class="card empty">No review yet.${canAct ? '<br>Press <strong>Run review</strong> to check this text against the brand kit.' : ''}</div>` :
      `<h3>${open.length ? open.length + ' to resolve' : 'Nothing left to resolve'}</h3>${open.map(f => findingCard(f, canAct)).join('') || '<div class="card empty">All findings are resolved. You can submit for approval.</div>'}
       ${done.length ? `<h3 style="margin-top:16px">Resolved (${done.length})</h3>${done.map(f => `<div class="f-card muted small"><strong>${CAT[f.category]}</strong>: ${esc(f.excerpt.slice(0, 80))} <span class="pill">${f.status}${f.dismissReason ? ': ' + esc(f.dismissReason) : ''}</span></div>`).join('')}` : ''}`}
    ${decide}</div></div>` : historyView();
  return `<div class="head"><div><h1>${esc(d.title)}</h1><div class="row"><span class="pill ${d.status}">${STATUS[d.status]}</span><span class="muted small">Version ${v.n} · by ${esc((S.users.find(x => x.id === d.author) || {}).name || d.author)}</span></div></div><div class="row">${actions}</div></div>
    <div class="tabs"><a class="${S.tab === 'review' ? 'on' : ''}" data-act="tab" data-id="review">Review</a><a class="${S.tab === 'history' ? 'on' : ''}" data-act="tab" data-id="history">History and comments</a></div>${body}`;
}

function historyView() {
  const d = S.doc;
  return `<div class="cols"><div class="card"><h3>Activity</h3><ul class="tl">${[...d.events].reverse().map(e => `<li><strong>${esc(e.actor)}</strong> <span class="muted small">(${e.role})</span> ${EVENT[e.type] || e.type}
      ${e.note ? `<div class="small muted">“${esc(e.note)}”</div>` : ''}<div class="small muted">${new Date(e.at).toLocaleString()}</div></li>`).join('')}</ul></div>
    <div><div class="card"><h3>Add a comment</h3><textarea id="cmt" style="min-height:80px" placeholder="Write a note for the team"></textarea>
      <div style="margin-top:8px"><button class="btn" data-act="comment">Post comment</button></div></div>
      <div class="card" style="margin-top:14px"><h3>Versions</h3><ul class="tl">${[...d.versions].reverse().map(v => `<li>Version ${v.n} <span class="muted small">${new Date(v.at).toLocaleString()}</span></li>`).join('')}</ul></div></div></div>`;
}

function homeView() {
  const creator = me().role === 'creator';
  return `<h1>Review content before it goes live</h1>
    <div class="hint"><strong>Try it in two minutes.</strong> Open “Nova launch post”, press <em>Run review</em>, accept or dismiss a few findings, then submit it. Switch to Marcus (manager) or Dana (reviewer) at the top right to approve it.</div>
    ${creator ? `<div class="card" style="margin-bottom:18px"><h2>Start a new review</h2><input type="text" id="nTitle" placeholder="Title, for example “Spring campaign post”" style="margin-bottom:8px">
      <textarea id="nText" placeholder="Paste your draft here, or load a .txt file below"></textarea>
      <div class="row" style="margin-top:8px"><input type="file" id="nFile" accept=".txt,.md" aria-label="Load a text file"><button class="btn" data-act="create">Create and open</button></div></div>` : `<p class="muted">Only creators start new reviews. Switch to Priya to add one.</p>`}
    <h2>All documents</h2>${S.docs.map(d => `<div class="card" style="margin-bottom:8px;cursor:pointer" data-act="open" data-id="${d.id}"><div class="row" style="justify-content:space-between"><strong>${esc(d.title)}</strong><span class="pill ${d.status}">${STATUS[d.status]}</span></div>
      <div class="small muted">Version ${d.version} · ${d.open} open finding(s) · by ${esc(d.author)}</div></div>`).join('') || '<div class="empty">No documents yet.</div>'}`;
}

function kitView() {
  const groups = { guideline: 'Guidelines', fact: 'Approved facts', term: 'Terminology' };
  const mgr = me().role === 'manager';
  return `<h1>Brand kit</h1><p class="muted">Every finding is checked against these sources. Nothing outside this list can be cited.</p>
    ${Object.entries(groups).map(([k, label]) => `<div class="card" style="margin-bottom:14px"><h2>${label}</h2>${S.sources.filter(s => s.kind === k).map(s => `<div class="src-item"><strong>${esc(s.id)} · ${esc(s.title)}</strong><div class="muted">${esc(s.body)}</div></div>`).join('')}</div>`).join('')}
    ${mgr ? `<div class="card"><h2>Add a source</h2><div class="row"><select class="f" id="sKind" style="width:auto"><option value="guideline">Guideline</option><option value="fact">Approved fact</option><option value="term">Term</option></select>
      <input type="text" id="sTitle" placeholder="Title" style="flex:1"></div><textarea id="sBody" style="min-height:70px;margin-top:8px" placeholder="The rule or fact, in one sentence"></textarea>
      <div class="row" style="margin-top:8px"><input type="text" id="sBan" placeholder="Term only: word to avoid" style="flex:1"><input type="text" id="sPref" placeholder="Term only: preferred word" style="flex:1"></div>
      <div style="margin-top:8px"><button class="btn" data-act="addSource">Add to brand kit</button></div></div>` : '<p class="muted small">Only a manager can edit the brand kit. Switch to Marcus to try it.</p>'}`;
}

function render() {
  const u = me(), main = S.view === 'doc' && S.doc ? docView() : S.view === 'kit' ? kitView() : homeView();
  document.getElementById('app').innerHTML = `<header class="top"><span class="logo" data-act="home">BrandLens</span><span class="sp"></span>
    <span class="aibadge" title="Disclosure of AI use">${S.ai.on ? 'AI-assisted review: ' + esc(S.ai.model) : 'Rules-only mode (no AI key set)'}</span>
    <label class="who">Viewing as <select id="who" aria-label="Switch demo user">${S.users.map(x => `<option value="${x.id}" ${x.id === S.user ? 'selected' : ''}>${x.name} (${x.role})</option>`).join('')}</select></label></header>
    <div class="wrap"><aside class="side"><nav><a class="${S.view === 'home' ? 'on' : ''}" data-act="home">Documents</a><a class="${S.view === 'kit' ? 'on' : ''}" data-act="kit">Brand kit</a></nav>
    <p class="small muted" style="padding:0 10px">Signed in as ${esc(u.name)}. Creators write and fix, managers and reviewers decide.</p>
    <p class="small" style="padding:0 10px"><a href="#" data-act="reset" class="muted">Reset demo data</a></p></aside>
    <main>${S.busy ? `<p class="note">${S.busy === true ? 'Working…' : esc(S.busy)}</p>` : ''}${main}</main></div>`;
  document.getElementById('who').onchange = async e => { S.user = e.target.value; localStorage.setItem('bl_user', S.user); await refresh().catch(() => { S.view = 'home'; S.doc = null; }); S.editing = false; render(); };
  const f = document.getElementById('nFile');
  if (f) f.onchange = () => { const file = f.files[0]; if (!file) return; const r = new FileReader(); r.onload = () => { document.getElementById('nText').value = r.result; const t = document.getElementById('nTitle'); if (!t.value) t.value = file.name.replace(/\.\w+$/, ''); }; r.readAsText(file); };
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, val = i => (document.getElementById(i) || {}).value || '';
  if (el.tagName === 'A') e.preventDefault();
  const post = (p, b) => api(p, 'POST', b).then(async d => { await refresh(); if (d && d.versions) S.doc = d; });
  const doc = () => 'documents/' + S.doc.id + '/';
  const map = {
    home: () => { S.view = 'home'; S.doc = null; refresh().then(render); },
    kit: () => run(async () => { S.sources = await api('sources'); S.view = 'kit'; }),
    tab: () => { S.tab = id; render(); },
    sel: () => { S.sel = id; render(); const m = document.querySelector('mark.sel'); if (m) m.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
    open: () => run(async () => { S.sources = await api('sources'); await openDoc(id); }),
    create: () => run(async () => { const d = await api('documents', 'POST', { title: val('nTitle'), content: val('nText') }); S.sources = await api('sources'); await openDoc(d.id); await refresh(); }),
    review: () => run(async () => { S.doc = await api(doc() + 'review', 'POST'); S.sel = null; await refresh(); }, 'Checking against the brand kit…'),
    editText: () => { S.editing = !S.editing; render(); },
    saveText: () => run(async () => { S.doc = await api(doc() + 'content', 'POST', { content: val('editBox') }); S.editing = false; toast('Saved as a new version. Re-run the review to refresh findings.'); }),
    accept: () => run(async () => { await post(doc() + 'findings/' + id, { action: 'accept' }); }),
    edit: () => { const f = cur().findings.find(x => x.id === id); const v = prompt('Write your own replacement for this text:', f.replacement || f.excerpt); if (v !== null) run(async () => { await post(doc() + 'findings/' + id, { action: 'edit', replacement: v }); }); },
    dismiss: () => { const r = prompt('Why are you dismissing this finding? (short reason)'); if (r !== null) run(async () => { await post(doc() + 'findings/' + id, { action: 'dismiss', reason: r }); }); },
    submit: () => run(async () => { await post(doc() + 'submit'); toast('Submitted. Switch to Marcus or Dana to decide.'); }),
    approve: () => run(async () => { await post(doc() + 'decision', { decision: 'approve', note: val('decNote') }); }),
    changes: () => run(async () => { await post(doc() + 'decision', { decision: 'changes', note: val('decNote') }); }),
    comment: () => run(async () => { await post(doc() + 'comment', { note: val('cmt') }); }),
    addSource: () => run(async () => { await api('sources', 'POST', { kind: val('sKind'), title: val('sTitle'), body: val('sBody'), banned: val('sBan'), preferred: val('sPref') }); S.sources = await api('sources'); toast('Added to the brand kit.'); }),
    reset: () => run(async () => { await api('reset', 'POST'); S.view = 'home'; S.doc = null; await refresh(); toast('Demo data reset.'); }),
  };
  if (map[act]) map[act]();
});
refresh().then(render).catch(e => { document.getElementById('app').innerHTML = '<p style="padding:24px">Could not reach the server: ' + esc(e.message) + '</p>'; });
