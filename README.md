# Integration Readiness Copilot (Streamlit prototype)

Helps a developer answer, **before** spending hours on setup: *Can this app do what my client needs? What will block me? How long will it take? What do I do next?*

The rule behind it: **answer the most expensive question first**. That means feasibility, then access, then approvals, then setup steps, then proof.


## 3-minute demo
1. Under **Try an example**, click **Slack**, then **Assess integration**. The verdict is *Answer open questions before building*, because deleting Slack messages depends on whose messages they are.
2. Click **Any message in the workspace**. The verdict changes, and a new blocker appears with a ready-to-send request for the client's admin.
3. **Guide** tab: tick off the next task. **Blockers** tab: set one to *Waiting for external party*.
4. **Evidence** tab: record a test result. **Share** tab: copy the link (it reopens your exact progress) or download the report.
5. Click **New assessment**, type **Notion**, and assess it. You'll see how an app *without* a researched guide is handled. Click **Run live research with Gemini**.

## What's in the prototype

| Strategy feature | In the app |
|---|---|
| Start with an app or a requirement | Two modes: a plain-language requirement form, or the searchable library |
| Feasibility first | Verdict plus a status for each operation: Supported / Conditionally supported / Unsupported / Unverified |
| Ask only the question that changes the outcome | One clarifying question per guide; the verdict updates when you answer |
| Blockers with states and specific handoffs | Open → Waiting → Resolved / Accepted limitation, with copy-ready requests |
| Three separate estimates | Engineering effort, external waiting, uncertainty |
| Progressive guide | Six stages, with "your next task" first, who does it, and how you know it's done |
| Evidence and confidence | Claims tagged *documented / inferred / tested* with sources; your test results become evidence |
| Library and live research | 4 researched guides (Slack, Google Drive, Shopify, MongoDB Atlas), a 110-app directory, and Gemini research for anything else |
| Share and resume | The whole state lives in the link; Markdown report download |

**Files:** `streamlit_app.py` (screens), `copilot/logic.py` (verdicts, report), `copilot/research.py` (Gemini), `data/curated/` (researched guides), `data/directory.json` (110 apps), `tests/` (`python -m pytest`, after `pip install pytest`).

## Key product decisions
1. **Feasibility before setup.** The first result is a verdict on the client's *requested operations*, not an OAuth tutorial. Finding out late is the costliest failure.
2. **Depth over breadth, in tiers.** 4 deeply researched guides, a 110-app directory honestly labelled "not researched", and live research on demand. A library of 100 unverified guides would look complete but break trust.
3. **"Not found" never means "unsupported."** Unknowns show as *Unverified* with a next step. A requested operation a guide doesn't cover appears as an explicit gap.
4. **One clarifying question, not a long form.**
5. **Workarounds say what they don't do.** Every alternative lists what it "does not cover".
6. **Plain-language confidence.** Evidence labels instead of an AI confidence score; the developer's own tests count as the strongest evidence.
7. **A free model, with honest fallbacks.** Gemini researches with Google Search when the key allows it. If search grounding isn't available, it falls back to the model's own knowledge and automatically downgrades every claim to "inferred". If a model is unavailable or out of free quota, it tries the next Flash model.
8. **The link is the save file.** Answers, progress and test results are stored in the URL. No database or accounts are needed, and the share link always reopens the exact state.
9. **No credentials, ever.** The app never asks for provider tokens, and links and reports never contain them.

## Limitations
- **The 4 guides were checked against official docs (via web search) on 2026-10-27.** Claims marked *inferred* need a human check before you quote them to a client. Nothing re-checks provider changes automatically yet.
- **Live research was tested against a simulated Gemini response, not a real key.** Treat its output as a draft for human review; the app labels it that way.
- **Free Gemini keys have tight, changing limits** (requests per minute and per day), and Google may use free-tier inputs to improve its products. Don't put confidential client details in requirements on a free key.
- **Live-research results are kept only while the app is running.** On Streamlit Cloud the app sleeps when unused. After a restart, a shared live-research link asks the viewer to research again; researched guides are unaffected.
- Source links from Google Search grounding are Google redirect links and can expire. The research notes also list the original URLs.
- Requirement understanding for researched guides is keyword matching (create / read / update / delete plus resource names).
- The app records tests you run; it doesn't run API tests itself. Estimates are judgment, not data.
- **Deliberately not built:** automatic app creation in provider dashboards, automatic approval submissions, continuous monitoring, and a connector-building IDE.

## Next steps I'd prioritize
1. Interview 5–8 connector developers to confirm that late feasibility discovery is the costliest problem.
2. Add a human review step before live research joins the library permanently.
3. Run safe automated validation calls in sandboxes.
4. Re-check sources on a schedule and flag stale guides.

---

## Also in this repository: `node-prototype/`
The first version of this prototype (Node.js + Anthropic Claude). It is **not** used by the Streamlit deployment. See `node-prototype/README.md` to run it locally.
