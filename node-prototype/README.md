# Integration Readiness Copilot (prototype)

Helps a developer answer, **before** they spend hours on setup: *Can this app do what my client needs? What will block me? How long will it take? What exactly do I do next?*

It follows one rule: **answer the most expensive question first.** First feasibility, then access, then approvals, then setup steps, then proof.

---

## Setup (no experience needed, about 10 minutes)

You only do steps 1–3 once.

**1. Install Node.js** (the program that runs this app)
- Go to https://nodejs.org and download the version marked **LTS**.
- Open the downloaded file and click *Next / Continue* until it finishes. Keep the default settings.

**2. Unzip the project**
- Download `integration-readiness-copilot.zip` and double-click it. You'll get a folder called `integration-readiness-copilot`.
- Move that folder somewhere easy to find, such as your Desktop.

**3. Open a terminal inside that folder**
- **Mac:** open the **Terminal** app (press ⌘+Space and type "Terminal"). Type `cd ` (with a space after it), drag the folder into the Terminal window, and press **Enter**.
- **Windows:** open the folder, click the address bar at the top, type `cmd`, and press **Enter**.

Then type this and press **Enter**. It downloads the one library the app needs:
```
npm install
```

**4. Start the app**
```
npm start
```
When you see `Open this in your browser: http://localhost:3000`, open that address in Chrome, Safari or Edge.
To stop the app, click the terminal window and press **Ctrl + C**. To start it again later, repeat steps 3 and 4 (you can skip `npm install`).

**5. (Optional) Turn on live research for apps without a guide**
The 4 researched guides and the 110-app directory work without this step. To let the app research *any* app with Claude:
1. Create an API key at https://console.anthropic.com (billing required; one research run costs a small amount).
2. In the project folder, make a copy of `.env.example` and rename the copy to `.env`. On Mac, files starting with a dot are hidden; press ⌘+Shift+. to show them.
3. Open `.env` in a text editor (TextEdit or Notepad) and paste your key after the `=`, like `ANTHROPIC_API_KEY=sk-ant-...`. Save.
4. Stop the app (Ctrl + C) and run `npm start` again. The top-right badge now says **Live research: on**.

Never share your `.env` file or paste your key anywhere else.

**Check that everything works** (optional): run `npm test`. You should see "All checks passed".

### 3-minute demo script
1. **Try an example → Slack**, choose *External customers*, then **Assess integration**. The verdict is "Answer open questions before building", because deleting messages depends on *whose* messages they are.
2. Answer **Any message in the workspace**. The verdict changes, and a new blocker appears with a prepared request for the client's admin.
3. Open **Guide** and tick off the next task. Open **Blockers** and set one to *Waiting for external party*.
4. In **Evidence**, record a test result. In **Share**, create a link and download the report.
5. **Try an example → Notion** to see how the app treats an app it has *not* researched (or run live research if it's on).

---

## What's in the prototype

| Strategy feature | What you'll see |
|---|---|
| Start with an app or a requirement | Two entry modes. Plain-language requirement, who uses it, and how it runs |
| Requirement feasibility first | Verdict + per-operation status (Supported / Conditionally supported / Unsupported / Unverified) |
| Ask only the question that changes the outcome | One clarifying question per guide that re-scores the result when answered |
| Blockers with states + specific handoffs | Open → Waiting → Resolved / Accepted limitation, with copy-ready requests for admins or clients |
| Three separate estimates | Engineering effort, external waiting, uncertainty |
| Progressive guide | Six stages, "your next task" first, who does it, and how you know it's done |
| Evidence and confidence | Every claim is tagged *documented / inferred / tested* with a source link. Your own test results are added as evidence |
| Library + live research | 4 researched guides (Slack, Google Drive, Shopify, MongoDB Atlas). 110-app directory. Claude + web search for anything else; results are saved to the library |
| Share and resume | Progress is remembered in your browser. Share links keep progress in sync. Markdown report download |

**Files:** `public/` is the screens, `server.js` is the web server, `research.js` is live research, `data/curated/` holds the researched guides, `data/directory.json` holds the 110-app list (built by `scripts/build-directory.js`), and `data/generated/` holds saved live research.

---

## Key product decisions

1. **Feasibility comes before setup.** The first screen is a verdict on the client's *requested operations*, not an OAuth tutorial. Learning late that an operation can't be done is the costliest failure, so the app checks it first.
2. **Depth over breadth, in tiers.** 4 deeply researched guides, a 110-app directory that is honestly labelled *not researched*, and live research on demand. A library of 100 unverified guides would look complete but break trust.
3. **"Not found" never means "unsupported."** Unknowns are shown as *Unverified* with a next step. A requested operation that a guide doesn't cover appears as an explicit gap instead of being silently dropped.
4. **One clarifying question, not a long form.** Each guide asks only the question that changes the answer, for example whose Slack messages must be deleted, or which Drive files are needed.
5. **Workarounds always say what they don't do.** Every alternative lists what it "does not cover", so one business operation is never silently swapped for another.
6. **Evidence is plain language.** "Documented", "inferred" and "tested" instead of an AI confidence score. The developer's own test results are the strongest evidence.
7. **Live research runs in two steps.** Claude first researches the docs with web search, keeping citations. A second call turns the notes into the same structure as the researched guides, so every app looks and behaves the same.
8. **No credentials, ever.** The app never asks for provider credentials or tokens, and the share link and report never contain them. The Anthropic key stays on the server.

## Limitations

- **The facts in the 4 guides were checked against official documentation (via web search) on 2026-10-27.** Claims marked *inferred* need a human check before you quote them to a client. Provider rules change often, and nothing re-checks them automatically yet.
- **Live research was tested with a simulated Claude response, not a live API call** (no key was available while building). Treat its output as a draft that needs human review. The app labels it that way.
- **Requirement understanding is simple keyword matching** for researched guides (create / read / update / delete plus resource names). Unusual wording may need rephrasing.
- **The app doesn't run real API tests.** It records results of tests the developer runs. Automated, safe validation is the next step in the strategy.
- **Estimates are expert judgment, not data.** There's no outcome data yet to calibrate them.
- **Runs on your own computer.** Share links only work for people who can reach your machine until it's deployed. There are no user accounts. Shared guides are saved as files in `data/shared/`.
- **Deliberately not built** (per the strategy): automatic app creation in provider dashboards, automatic approval submissions, continuous monitoring of provider changes, and an IDE for building connectors.

## Next steps I'd prioritize
1. Interview 5–8 connector developers to confirm late feasibility discovery is the costliest problem.
2. Add a human review queue for live research before it joins the library.
3. Add safe automated validation calls in sandboxes.
4. Re-check sources on a schedule and flag stale guides.
