# BrandLens

Pre-publication brand governance. A creator pastes a draft; BrandLens checks it against the organisation's approved
guidelines, facts and terminology, explains every issue, cites the exact source, and suggests a fix that keeps the
writer's intent. People accept, edit or dismiss each suggestion, then a manager or reviewer approves. Everything is
logged.

## Try it (no setup for judges)
Open the live link, then:
1. Open **Nova launch post** and press **Run review**.
2. Click a highlighted phrase, then **Accept**, **Edit** or **Dismiss** (dismissing needs a reason).
3. Press **Submit for approval**.
4. Switch **Viewing as** (top right) to **Marcus (manager)** or **Dana (reviewer)** and approve or request changes.
5. Check **History and comments** for the audit trail and versions. **Brand kit** shows every source the tool can cite.

## Run locally
```bash
node -v        # 18 or newer
npm start      # http://localhost:3000, no install needed (zero dependencies)
npm test       # 21 checks: rules, trust layer, roles and workflow
```
Optional AI review: set the values from `.env.example` as environment variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`).
Without a key the app runs in **rules-only mode** and says so on screen.

## How it works
- **Rules engine** (deterministic): approved terms, urgency language, exclamation marks, ALL CAPS, long sentences,
  superlatives/guarantees, and numbers checked against approved facts.
- **AI review** (optional): sends the brand kit and the draft to the Claude API, asks for structured JSON with a
  source id and exact quotes, 25 s timeout.
- **Trust layer**: a finding is shown only if its excerpt really appears in the draft and its quote really appears in the
  cited source. Anything else is dropped and the count is shown to the user. If the AI call fails, the rule-based
  findings still appear with a clear notice.
- **Human control**: the AI never edits or approves. Accept applies a stored suggestion as a new version; every
  action is logged. A reviewer cannot approve over open high-severity findings; a manager can, but must write a note.
- **Roles are enforced on the server**, not just hidden in the UI.

## Stack
Node.js `http` server, vanilla JS front end, JSON file storage, Anthropic Messages API (optional).

## Changes from the Round 1 plan
- Next.js + Supabase replaced by a zero-dependency Node app and a JSON file, to keep one solo build reliable and easy
  to run. Move to Postgres/Supabase when real multi-user persistence is needed.
- Vector retrieval deferred: the brand kit is small enough to send whole, which is simpler and more reliable.
- Text only (paste or .txt). DOCX/PDF and image review are Round 3.
- Demo personas replace sign-up so judges can try every role.

## Known limitations
- Demo data lives in one file and is shared by everyone who opens the link; use **Reset demo data** if it gets messy.
  On hosts with ephemeral disks (e.g. Vercel, free tiers) data resets on restart.
- The rule-based claim checker is keyword and number based; it is deliberately conservative.
- The AI path needs a key to run; the verification code for it is covered by unit tests with sample responses.

## Round 3 (planned)
1. Intent-preserving rewrites: three options per finding shown as a diff.
2. Guideline Health insights: recurring mistakes and rules people often dismiss, with clearer-wording suggestions.
3. Visual and accessibility review: images (alt text, contrast, palette, logo rules) and DOCX/PDF import.

## Disclosure
Developed with AI coding assistance (Claude). Runtime AI use is optional and shown in the app header. No third-party
libraries are used at runtime.
