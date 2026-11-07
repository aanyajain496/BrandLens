// Run with: npm test   (starts its own server on a temp data dir; no AI key needed)
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'bl-'));
delete process.env.ANTHROPIC_API_KEY;
const assert = require('assert');
const { runRules, isGrounded, parseAiFindings, applyReplacement, createServer, SEED_SOURCES } = require('./server');
let pass = 0; const t = (name, fn) => Promise.resolve(fn()).then(() => { pass++; console.log('  ok  ' + name); }, e => { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; });

(async () => {
  console.log('Rules engine');
  const bad = "Meet Nova, the world's fastest smart bottle!\nThis little GADGET is guaranteed to cut hydration mistakes by 100%. The battery lasts 30 days on a single charge, and it is cheap enough for everyone. Hurry, this offer won't last!!";
  const f = runRules(bad, SEED_SOURCES);
  await t('catches superlative/guarantee claims', () => assert(f.some(x => x.category === 'claim' && x.sourceId === 'G4' && x.severity === 'high')));
  await t('catches a number that contradicts an approved fact', () => { const x = f.find(x => x.sourceId === 'F2'); assert(x && x.replacement.includes('14 days')); });
  await t('catches banned terms and all-caps words', () => { assert(f.some(x => x.sourceId === 'T1')); assert(f.some(x => x.sourceId === 'T2')); assert(f.some(x => x.sourceId === 'A1' && x.excerpt === 'GADGET')); });
  await t('catches urgency language', () => assert(f.some(x => x.sourceId === 'G3')));
  await t('every rule finding is grounded in content and source', () => assert(f.every(x => isGrounded(x, bad, SEED_SOURCES))));
  const clean = 'Welcome back. Nova reduces missed hydration reminders by up to 30% in our 2025 user study. Thanks for reading.';
  await t('a clean post produces no findings (no false flags)', () => assert.strictEqual(runRules(clean, SEED_SOURCES).length, 0));

  console.log('Trust layer');
  const fake = { category: 'claim', severity: 'high', excerpt: 'cuts mistakes', why: 'x', sourceId: 'F1', sourceQuote: 'Nova cures all thirst', suggestion: 'x' };
  await t('drops a finding whose source quote is invented', () => assert(!isGrounded(fake, 'It cuts mistakes', SEED_SOURCES)));
  await t('drops a finding whose excerpt is not in the content', () => assert(!isGrounded({ ...fake, sourceQuote: 'Nova reduces missed hydration reminders by up to 30%' }, 'Something else', SEED_SOURCES)));
  await t('drops a finding citing an unknown source', () => assert(!isGrounded({ ...fake, sourceId: 'ZZ' }, 'It cuts mistakes', SEED_SOURCES)));
  await t('parses fenced AI JSON and rejects malformed items', () => {
    const r = parseAiFindings('```json\n{"findings":[{"category":"tone","severity":"low","excerpt":"a","why":"b","sourceId":"G1","sourceQuote":"c","suggestion":"d"},{"category":"bogus"}]}\n```');
    assert.strictEqual(r.length, 1);
  });
  await t('rejects non-JSON AI output', () => assert.throws(() => parseAiFindings('Sorry, I cannot')));
  await t('applyReplacement tidies spacing', () => assert.strictEqual(applyReplacement('Hi there , Hurry up now.', 'Hurry up', ''), 'Hi there, now.'));

  console.log('Workflow over HTTP');
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port;
  const call = async (user, path, method = 'GET', body) => { const r = await fetch(base + '/api/' + path, { method, headers: { 'x-user': user, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const list = (await call('priya', 'state')).body.docs; const id = list.find(d => d.title === 'Nova launch post').id;
  await t('rejects requests without a user', async () => assert.strictEqual((await call('nobody', 'state')).status, 401));
  await t('creator runs a review and gets cited findings', async () => { const r = await call('priya', `documents/${id}/review`, 'POST'); assert.strictEqual(r.status, 200); const v = r.body.versions.at(-1); assert(v.findings.length >= 5); assert(v.findings.every(x => x.sourceId && x.sourceQuote)); assert.strictEqual(v.run.mode, 'rules-only'); });
  await t('manager cannot run reviews (role enforced server-side)', async () => assert.strictEqual((await call('marcus', `documents/${id}/review`, 'POST')).status, 403));
  await t('accept applies the fix and creates a new version', async () => {
    const d = (await call('priya', 'documents/' + id)).body, f = d.versions.at(-1).findings.find(x => x.sourceId === 'T1');
    const r = await call('priya', `documents/${id}/findings/${f.id}`, 'POST', { action: 'accept' });
    assert(r.body.versions.at(-1).content.includes('smart bottle') && !/gadget/i.test(r.body.versions.at(-1).content)); assert.strictEqual(r.body.versions.length, 2);
  });
  await t('dismiss needs a reason', async () => {
    const d = (await call('priya', 'documents/' + id)).body, f = d.versions.at(-1).findings.find(x => x.status === 'open');
    assert.strictEqual((await call('priya', `documents/${id}/findings/${f.id}`, 'POST', { action: 'dismiss' })).status, 400);
    assert.strictEqual((await call('priya', `documents/${id}/findings/${f.id}`, 'POST', { action: 'dismiss', reason: 'Approved by legal' })).status, 200);
  });
  await t('reviewer cannot approve over open high-severity findings', async () => {
    await call('priya', `documents/${id}/submit`, 'POST');
    const r = await call('dana', `documents/${id}/decision`, 'POST', { decision: 'approve', note: 'ok' }); assert.strictEqual(r.status, 403);
  });
  await t('creator cannot edit while in review', async () => assert.strictEqual((await call('priya', `documents/${id}/content`, 'POST', { content: 'x' })).status, 403));
  await t('manager approving over high findings needs a note, then succeeds and is logged', async () => {
    assert.strictEqual((await call('marcus', `documents/${id}/decision`, 'POST', { decision: 'approve' })).status, 400);
    const r = await call('marcus', `documents/${id}/decision`, 'POST', { decision: 'approve', note: 'Legal confirmed in email' });
    assert.strictEqual(r.body.status, 'approved'); assert(r.body.events.some(e => e.type === 'approve_override'));
  });
  await t('only managers edit the brand kit', async () => {
    assert.strictEqual((await call('priya', 'sources', 'POST', { kind: 'fact', title: 'x', body: 'y' })).status, 403);
    assert.strictEqual((await call('marcus', 'sources', 'POST', { kind: 'fact', title: 'Warranty', body: 'Nova has a 2-year warranty.' })).status, 200);
  });
  srv.close(); console.log(`\n${pass} checks passed${process.exitCode ? ', some FAILED' : ''}.`);
})();
