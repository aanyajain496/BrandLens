# BrandLens

**Pre-publication brand governance.** BrandLens helps teams check draft
content against approved brand guidelines, facts and terminology before
publication. It explains issues, cites supporting sources, and gives
creators control over suggested changes. A manager or reviewer then
handles approval, with actions recorded in the audit trail.

## Try it (no setup for judges)

Open the live link, then:

1.  Open **Nova launch post** and select **Run review**.
2.  Select a highlighted phrase to inspect the finding, its explanation
    and cited source.
3.  Choose **Accept**, **Edit** or **Dismiss**. Dismissal requires a
    reason.
4.  Select **Submit for approval**.
5.  Use **Viewing as** in the top-right corner to switch to **Marcus
    (manager)** or **Dana (reviewer)**, then approve or request changes.
6.  Open **History and comments** to inspect versions and the audit
    trail.
7.  Open **Brand kit** to review the guidelines and approved facts used
    as review sources.
8.  Open **Guideline Health** to see recurring findings, frequently
    dismissed rules and guideline wording that may need attention.

## Run locally

Requirements: Node.js 18 or newer.

``` bash
node -v
npm start
```

The app runs at `http://localhost:3000`. It uses Node.js built-in
modules and has no runtime npm dependencies.

Run the automated test suite in a separate terminal:

``` bash
npm test
```

**Test status:** 33 automated checks passed in the supplied project test
run. The suite covers review rules, evidence validation, AI-response and
rewrite validation, role permissions, workflow/API behaviour,
dismissals, approval and manager override behaviour, and insights.

### Optional AI review

Copy the values from `.env.example` into your environment:

-   `ANTHROPIC_API_KEY`
-   `ANTHROPIC_MODEL`

Without an API key, BrandLens runs in **rules-only mode** and indicates
this in the interface. The deterministic checks remain available.

## How it works

### 1. Draft and brand kit

A creator opens a sample draft, pastes text, or imports a `.txt` file.
The brand kit provides approved guidelines, facts and preferred
terminology that the review engine can use as sources.

### 2. Review engine

The deterministic rules engine checks for issues such as:

-   Use of unapproved or inconsistent terminology
-   Urgency language
-   Excessive exclamation marks and ALL CAPS
-   Long or difficult-to-read sentences
-   Superlatives, guarantees and potentially unsupported claims
-   Numerical claims that do not match approved facts

When configured, the optional Claude API review can identify additional
context-dependent issues and return structured findings with source
references and suggested wording.

### 3. Evidence validation

BrandLens does not display an AI finding merely because the model
returned it. The trust layer verifies that the finding's excerpt appears
in the draft and that the quoted evidence appears in the cited brand-kit
source. Unsupported findings are rejected rather than shown as verified.
If the AI request fails, the deterministic findings remain available and
the interface displays a notice.

### 4. Creator-controlled corrections

For each finding, the creator can accept a suggested correction, edit
the wording, or dismiss the finding with a reason. Accepted changes
create a new document version. The AI does not directly edit the
document or approve it.

### 5. Approval and audit trail

The workflow supports Creator, Manager and Reviewer demo roles. Role
permissions are enforced by the server:

-   A reviewer cannot approve a document while high-severity findings
    remain open.
-   A manager can override that restriction only by providing a note.
-   Users can submit a document for approval, approve it or request
    changes.
-   Actions, comments and document versions are recorded in the history.

### 6. Guideline Health

Guideline Health surfaces patterns from review activity, including
recurring findings and rules that are frequently dismissed. It helps
teams identify guidelines that may be unclear or need review. Managers
can review proposed wording changes and the guideline revision history.

## Technology

-   **Backend:** Node.js built-in `http` server
-   **Frontend:** HTML, CSS and vanilla JavaScript
-   **Storage:** Server-side JSON file
-   **Optional AI:** Anthropic Messages API (Claude)
-   **Runtime dependencies:** None; the app uses Node.js built-in
    modules

## Changes from the Round 1 plan

-   **Simplified infrastructure:** Next.js and Supabase were replaced
    with a zero-dependency Node.js application and JSON-file storage.
    This keeps the solo build straightforward to run. A database-backed
    solution is a future step for persistent multi-user use.
-   **No vector retrieval in this version:** The current brand kit is
    small enough to provide to the review process directly, avoiding the
    added complexity of a retrieval system.
-   **Text-first input:** Drafts can be pasted or imported as `.txt`.
    DOCX, PDF and image review are not currently supported.
-   **Demo personas:** Creator, Manager and Reviewer demo identities let
    evaluators try the role-based workflow without a sign-up process.

## Known limitations

-   **Shared demo data:** The demo uses one server-side JSON data file.
    People using the same deployed instance share that data; use **Reset
    demo data** to restore the demo. Hosts with ephemeral storage may
    reset the data when the instance restarts.
-   **Not production authentication:** Demo personas are for evaluation
    and are not a substitute for production identity management and
    account security.
-   **Storage scale:** JSON-file storage is suitable for the demo, but
    is not designed for robust concurrent multi-user persistence.
-   **Rule coverage:** The deterministic claim checker uses patterns and
    number matching. It is intentionally conservative and cannot
    understand every claim or context.
-   **Optional AI dependency:** AI-assisted review requires a valid
    Anthropic API key and model configuration. Rules-only review works
    without them.
-   **Input formats:** The current workflow is text-based; DOCX, PDF and
    image review remain future work.
-   **Testing scope:** Automated checks cover core logic and workflows.
    They do not replace formal user testing, production security review
    or evaluation across a large range of real-world brand documents.

## Roadmap

The following are planned improvements, not features claimed as complete
in this version.

1.  **Production-ready collaboration and persistence**
    -   Add real user authentication and organisation-level access
        controls.
    -   Move from JSON-file storage to PostgreSQL or Supabase.
    -   Add stronger audit, backup and concurrent-edit handling.
2.  **More document formats and integrations**
    -   Support DOCX and PDF import.
    -   Explore image and visual-brand review, including alt text,
        contrast, palette and logo rules.
    -   Consider integrations with content and publishing workflows.
3.  **Deeper brand intelligence**
    -   Improve configurable rules and claim validation.
    -   Expand analytics, readiness indicators and version comparisons.
    -   Improve guideline-maintenance workflows using review trends and
        team feedback.
4.  **Team collaboration**
    -   Add real user accounts, notifications and richer collaboration
        around review comments and approvals.
    -   Evaluate the workflow with teams using their own brand kits and
        publication processes.
