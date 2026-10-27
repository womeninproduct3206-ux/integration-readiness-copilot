// Integration Readiness Copilot: front end (no framework, no build step).
// Flow: requirement -> feasibility -> blockers -> estimate -> guide -> evidence -> share.

const app = document.getElementById("app");
const S = { config: { liveResearch: false }, apps: [], current: null };

const STATUS_LABEL = {
  supported: "Supported",
  conditional: "Conditionally supported",
  unsupported: "Unsupported",
  unverified: "Unverified",
};
const BLOCKER_STATES = ["Open", "Waiting for developer", "Waiting for external party", "Resolved", "Accepted limitation"];
const AUDIENCE = { internal: "My own team", external: "External customers or multiple tenants" };
const RUNTIME = {
  interactive: "During an interactive user session",
  background: "As a background automation or AI agent",
  both: "Both",
  unsure: "I'm not sure yet",
};
const TIER = {
  curated: { label: "Researched guide", cls: "curated" },
  live: { label: "Live research · needs human review", cls: "live" },
  directory: { label: "Directory entry · not researched", cls: "directory" },
  unknown: { label: "New app · not in library", cls: "directory" },
};

// ---------- helpers ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const link = (u, text) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(text || u)}</a>` : esc(text || ""));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    prompt("Copy this:", text);
  }
}

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: progress just isn't remembered */ }
  },
};

function parseHash() {
  const [route, query = ""] = location.hash.replace(/^#/, "").split("?");
  return { route: route || "/", params: new URLSearchParams(query) };
}

function go(route, params) {
  const q = params ? `?${new URLSearchParams(params)}` : "";
  location.hash = `#${route}${q}`;
}

// ---------- requirement understanding ----------
const OP_PATTERNS = {
  create: /\b(creat|add|post|send|upload|insert|writ|new)\w*/i,
  read: /\b(read|get|list|fetch|view|sync|search|retriev|download|quer|export)\w*/i,
  update: /\b(updat|edit|modif|chang|patch|renam)\w*/i,
  delete: /\b(delet|remov|eras|destroy|trash)\w*/i,
};

function detectOps(text) {
  if (/\bcrud\b/i.test(text)) return ["create", "read", "update", "delete"];
  return Object.keys(OP_PATTERNS).filter((op) => OP_PATTERNS[op].test(text));
}

const stem = (word) => word.toLowerCase().replace(/s$/, "");

// Combines the assessment with the requirement, the developer's answers and test results.
function derive(assessment, context, state) {
  const text = context.requirement || "";
  const ops = detectOps(text);
  const caps = (assessment.capabilities || []).map((c) => ({ ...c, evidence: [...(c.evidence || [])] }));

  // Apply answers to clarifying questions.
  const clarifications = assessment.clarifications || [];
  for (const q of clarifications) {
    const answer = state.answers[q.id];
    if (answer === undefined) continue;
    for (const effect of q.options[answer]?.effects || []) {
      const cap = caps.find((c) => c.id === effect.capability);
      if (!cap) continue;
      if (effect.hide) cap.hidden = true;
      if (effect.status) cap.status = effect.status;
      if (effect.conditions) cap.conditions = effect.conditions;
      cap.answeredBy = q.options[answer].label;
    }
  }

  // Apply the developer's own test results (strongest evidence we have).
  for (const t of state.tests) {
    const cap = caps.find((c) => c.id === t.capability);
    if (!cap) continue;
    cap.evidence.push({ type: "tested", title: `${t.result}${t.note ? ` — ${t.note}` : ""} (${t.date})`, url: "" });
    if (t.result.startsWith("Failed — capability gap")) {
      cap.status = "unsupported";
      cap.conditions = `Your test showed the operation is not available${t.note ? `: ${t.note}` : ""}.`;
    } else if (t.result.startsWith("Passed") && cap.status === "unverified") {
      cap.status = "conditional";
      cap.conditions = "Confirmed by your test. Conditions are not fully documented yet.";
    }
    cap.tested = true;
  }

  // Which capabilities did the client actually ask for?
  const resources = [...new Set(caps.map((c) => c.resource))];
  const mentioned = resources.filter((r) => new RegExp(`\\b${stem(r)}`, "i").test(text));
  for (const c of caps) {
    const resourceOk = mentioned.length === 0 || mentioned.includes(c.resource);
    const byKeyword = (c.keywords || []).some((k) => text.toLowerCase().includes(k));
    c.requested = !text || ops.length === 0 ? c.op !== "other" || byKeyword : (resourceOk && ops.includes(c.op)) || byKeyword;
  }
  if (assessment.tier === "live") caps.forEach((c) => (c.requested = true));

  // Requested operations this guide doesn't cover become explicit unknowns, never silent gaps.
  // Only when one resource is in play: with several we can't tell which verb goes with which noun.
  const scope = mentioned.length ? mentioned : resources.length === 1 ? resources : [];
  if (assessment.tier === "curated" && ops.length && scope.length === 1) {
    for (const r of scope) {
      for (const op of ops) {
        if (!caps.some((c) => c.resource === r && c.op === op)) {
          caps.push({
            id: `gap-${r}-${op}`, resource: r, op, requested: true, synthetic: true,
            label: `${op[0].toUpperCase()}${op.slice(1)} ${r.toLowerCase()}`, method: "—", status: "unverified",
            conditions: "Not covered by this researched guide. Check the official API reference or run live research before promising it.",
            evidence: [],
          });
        }
      }
    }
  }

  const visible = caps.filter((c) => !c.hidden);
  const requested = visible.filter((c) => c.requested);
  const others = visible.filter((c) => !c.requested);
  const unanswered = clarifications.filter((q) => state.answers[q.id] === undefined);

  const applies = (b) => {
    const a = b.appliesTo || {};
    if (a.audience && context.audience && !a.audience.includes(context.audience)) return false;
    if (a.runtime && context.runtime && !a.runtime.includes(context.runtime)) return false;
    if (a.answer) {
      return Object.entries(a.answer).every(([qid, idxs]) => idxs.includes(state.answers[qid]));
    }
    return true;
  };
  const blockers = (assessment.blockers || []).filter(applies).map((b) => ({ ...b, state: state.blockerStates[b.id] || "Open" }));
  const openBlockers = blockers.filter((b) => !["Resolved", "Accepted limitation"].includes(b.state));

  const has = (s) => requested.some((c) => c.status === s);
  let verdict;
  if (has("unsupported")) {
    verdict = { cls: "blocked", label: "Not feasible as specified", rec: "At least one requested operation is unavailable. Revise the requirement with the client before building. See the alternatives below." };
  } else if (unanswered.length || has("unverified")) {
    verdict = { cls: "questions", label: "Answer open questions before building", rec: "Some requested behaviour depends on details we don't know yet. Resolve the questions below first. They change the design." };
  } else if (has("conditional")) {
    verdict = { cls: "conditions", label: "Feasible with conditions", rec: "Every requested operation is available, under the conditions listed. Confirm them with the client, then follow the guide." };
  } else {
    verdict = { cls: "go", label: "Feasible", rec: "Every requested operation is supported. Follow the guide." };
  }
  return { requested, others, unanswered, blockers, openBlockers, verdict };
}

// ---------- home ----------
function renderHome(params) {
  const mode = params.get("mode") || "requirement";
  const curated = S.apps.filter((a) => a.tier === "curated");
  const pre = { app: params.get("name") || "", req: params.get("req") || "", aud: params.get("aud") || "external", run: params.get("run") || "unsure" };

  app.innerHTML = `
    <section class="stack">
      <h1>What are you trying to integrate?</h1>
      <p class="muted">Start with a provider or describe what your client needs. You don't need to know any OAuth terminology.</p>
      <div class="segmented" role="group" aria-label="Start mode">
        <button data-mode="app" aria-pressed="${mode === "app"}">I know the app</button>
        <button data-mode="requirement" aria-pressed="${mode === "requirement"}">I have a requirement</button>
      </div>
    </section>
    <div id="mode-body" style="margin-top:1rem"></div>`;

  app.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => go("/", { mode: b.dataset.mode })));

  const body = document.getElementById("mode-body");
  if (mode === "app") return renderLibrary(body);

  body.innerHTML = `
    <form class="card stack" id="req-form">
      <div>
        <label class="field" for="provider">Which app or provider?</label>
        <input type="text" id="provider" list="app-names" placeholder="e.g. Slack, Google Drive, or any app name" value="${esc(pre.app)}" required autocomplete="off">
        <datalist id="app-names">${S.apps.map((a) => `<option value="${esc(a.name)}">`).join("")}</datalist>
      </div>
      <div>
        <label class="field" for="requirement">What does the client want to accomplish?</label>
        <textarea id="requirement" placeholder="Build a Slack connector that supports creating, reading, updating, and deleting messages.">${esc(pre.req)}</textarea>
      </div>
      <fieldset style="border:0;padding:0;margin:0">
        <legend class="field">Who will use the integration?</legend>
        <div class="choices">${Object.entries(AUDIENCE).map(([k, v]) => `<label><input type="radio" name="aud" value="${k}" ${pre.aud === k ? "checked" : ""}><span>${esc(v)}</span></label>`).join("")}</div>
      </fieldset>
      <fieldset style="border:0;padding:0;margin:0">
        <legend class="field">How will it run?</legend>
        <div class="choices">${Object.entries(RUNTIME).map(([k, v]) => `<label><input type="radio" name="run" value="${k}" ${pre.run === k ? "checked" : ""}><span>${esc(v)}</span></label>`).join("")}</div>
      </fieldset>
      <div class="row"><button class="btn primary" type="submit">Assess integration</button></div>
    </form>
    <div class="card">
      <h3>Try an example</h3>
      <div class="row" style="margin-top:.5rem">
        ${curated.map((a) => `<button class="btn small" data-example="${esc(a.id)}">${esc(a.name)}</button>`).join("")}
        <button class="btn small" data-example="notion">Notion (unfamiliar app)</button>
      </div>
      <p class="small muted" style="margin-top:.75rem">Library: ${curated.length} researched guides · ${S.apps.length} apps in the directory. <a href="#/?mode=app">Browse all</a></p>
    </div>`;

  const examples = {
    notion: "Let users create pages in a Notion database, read and update them, and archive pages that are no longer needed.",
  };
  body.querySelectorAll("[data-example]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.example;
      const a = S.apps.find((x) => x.id === id);
      document.getElementById("provider").value = a?.name || id;
      let req = examples[id] || "";
      if (!req) req = (await api(`/api/apps/${id}`)).defaultRequirement || "";
      document.getElementById("requirement").value = req;
    }));

  document.getElementById("req-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("provider").value.trim();
    const match = S.apps.find((a) => a.name.toLowerCase() === name.toLowerCase() || a.id === slug(name));
    go("/assess", {
      app: match ? match.id : slug(name),
      name: match ? match.name : name,
      req: document.getElementById("requirement").value.trim(),
      aud: e.target.aud.value,
      run: e.target.run.value,
    });
  });
}

function renderLibrary(body) {
  body.innerHTML = `
    <div class="card stack">
      <label class="field" for="search">Search the library</label>
      <input type="search" id="search" placeholder="Search ${S.apps.length} apps by name or category" autocomplete="off">
      <div class="row" role="group" aria-label="Filter">
        <button class="btn small" data-filter="all" aria-pressed="true">All</button>
        <button class="btn small" data-filter="researched">Researched guides</button>
        <button class="btn small" data-filter="directory">Not researched yet</button>
      </div>
    </div>
    <div class="app-grid" id="grid"></div>
    <p class="small muted" style="margin-top:1rem">Can't find it? Type the name in “I have a requirement”. ${S.config.liveResearch ? "Live research will investigate it." : "Turn on live research (see README) to research any app."}</p>`;
  let filter = "all";
  const grid = body.querySelector("#grid");
  const search = body.querySelector("#search");
  const draw = () => {
    const q = search.value.toLowerCase();
    const list = S.apps
      .filter((a) => (filter === "all" ? true : filter === "researched" ? a.tier !== "directory" : a.tier === "directory"))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q))
      .sort((a, b) => (a.tier === "directory") - (b.tier === "directory") || a.name.localeCompare(b.name));
    grid.innerHTML = list.map((a) => `
      <a class="app-tile" href="#/assess?${new URLSearchParams({ app: a.id, name: a.name })}">
        <div class="name">${esc(a.name)}</div>
        <div class="small muted">${esc(a.category)}</div>
        <div style="margin-top:.4rem"><span class="chip ${TIER[a.tier].cls}">${esc(TIER[a.tier].label.split(" · ")[0])}</span></div>
      </a>`).join("") || `<p class="muted">No apps match “${esc(q)}”.</p>`;
  };
  search.addEventListener("input", draw);
  body.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    body.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  }));
  draw();
  search.focus();
}

// ---------- assessment ----------
const stateKey = (id, req) => `irc:${id}:${req}`;
const emptyState = () => ({ answers: {}, done: {}, blockerStates: {}, tests: [] });

async function openAssessment(params) {
  const id = params.get("app");
  const context = {
    requirement: params.get("req") || "",
    audience: params.get("aud") || "",
    runtime: params.get("run") || "",
  };
  const name = params.get("name") || id;
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Loading…</div>`;
  let assessment;
  try {
    assessment = await api(`/api/apps/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status !== 404 && err.status !== 400) return showError(err);
    assessment = { id, provider: name, tier: "unknown" };
  }
  if (!context.requirement && assessment.defaultRequirement) context.requirement = assessment.defaultRequirement;
  const state = storage.get(stateKey(id, context.requirement)) || emptyState();
  S.current = { assessment, context, state, shareId: null, tab: "feasibility" };
  renderAssessment();
}

async function openShared(shareId) {
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Loading shared guide…</div>`;
  try {
    const g = await api(`/api/guides/${shareId}`);
    S.current = { assessment: g.assessment, context: g.context, state: { ...emptyState(), ...g.state }, shareId, tab: "feasibility" };
    renderAssessment();
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  app.innerHTML = `<div class="error">${esc(err.message)}</div><p style="margin-top:1rem"><a href="#/">Start over</a></p>`;
}

let saveTimer;
function saveState() {
  const { assessment, context, state, shareId } = S.current;
  storage.set(stateKey(assessment.id, context.requirement), state);
  if (shareId) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api(`/api/guides/${shareId}`, { method: "PUT", body: { state } }).catch(() => toast("Couldn't save to the shared link")), 400);
  }
}

function renderAssessment() {
  const { assessment: a, context } = S.current;
  if (a.tier === "directory" || a.tier === "unknown") return renderUnresearched();

  const d = derive(a, context, S.current.state);
  const tasks = (a.guide || []).flatMap((s) => s.tasks);
  const doneCount = tasks.filter((t) => S.current.state.done[t.id]).length;
  const tier = TIER[a.tier];
  const tabs = [
    ["feasibility", "Feasibility", ""],
    ["guide", "Guide", `${doneCount}/${tasks.length}`],
    ["blockers", "Blockers", String(d.openBlockers.length)],
    ["evidence", "Evidence", ""],
    ["share", "Share", ""],
  ];
  const editParams = new URLSearchParams({ mode: "requirement", name: a.provider, req: context.requirement, aud: context.audience, run: context.runtime });

  app.innerHTML = `
    <p class="small"><a href="#/">← New assessment</a></p>
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div>
        <h1>${esc(a.provider)} connector assessment</h1>
        <p class="muted" style="margin:0">${esc(a.product || "")}</p>
      </div>
      <div class="row">
        <span class="chip ${tier.cls}">${esc(tier.label)}</span>
        <span class="small muted">Last checked ${esc(a.lastVerified || "—")}</span>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <div class="small muted">Client requirement${S.current.shareId ? " (shared guide)" : ""}</div>
      <p style="margin:.25rem 0 .5rem;font-weight:550">${esc(context.requirement || "Not specified: showing all known capabilities")}</p>
      <div class="meta">
        <span>Users: ${esc(AUDIENCE[context.audience] || "Not specified")}</span>
        <span>Runs: ${esc(RUNTIME[context.runtime] || "Not specified")}</span>
        ${S.current.shareId ? "" : `<a href="#/?${editParams}">Change</a>`}
      </div>
      ${a.tier === "live" && a.defaultRequirement && a.defaultRequirement !== context.requirement
        ? `<div class="notice small" style="margin-top:.75rem">This research was generated for: “${esc(a.defaultRequirement)}”. ${S.config.liveResearch ? `<button class="linkish" id="rerun">Re-run research for this requirement</button>` : ""}</div>` : ""}
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label, count]) => `<button role="tab" data-tab="${k}" aria-selected="${S.current.tab === k}">${label}${count ? `<span class="count">${esc(count)}</span>` : ""}</button>`).join("")}
    </div>
    <div id="tab-body" role="tabpanel"></div>`;

  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    S.current.tab = b.dataset.tab;
    renderAssessment();
  }));
  document.getElementById("rerun")?.addEventListener("click", () => runResearch());

  const body = document.getElementById("tab-body");
  ({ feasibility: tabFeasibility, guide: tabGuide, blockers: tabBlockers, evidence: tabEvidence, share: tabShare })[S.current.tab](body, d);
}

function capRow(c) {
  const sources = c.evidence.length;
  const types = [...new Set(c.evidence.map((e) => e.type))];
  return `
    <tr class="${c.requested ? "" : "not-requested"}">
      <td><strong>${esc(c.label)}</strong><div class="small muted"><code>${esc(c.method)}</code></div></td>
      <td><span class="chip ${esc(c.status)}">${esc(STATUS_LABEL[c.status] || c.status)}</span>${c.tested ? ` <span class="chip ev">tested</span>` : ""}</td>
      <td>${esc(c.conditions)}
        <div class="small muted" style="margin-top:.25rem">${sources ? `${sources} source${sources > 1 ? "s" : ""} · ${esc(types.join(", "))}` : "No evidence yet"}${c.answeredBy ? ` · based on your answer` : ""}</div>
      </td>
    </tr>`;
}

function tabFeasibility(body, d) {
  const { assessment: a, state } = S.current;
  const answered = (a.clarifications || []).filter((q) => state.answers[q.id] !== undefined);
  const alternatives = d.requested.some((c) => c.status !== "supported") ? a.alternatives || [] : [];
  const est = a.estimate || {};

  body.innerHTML = `
    <div class="card verdict ${d.verdict.cls}">
      <div class="label">Feasibility</div>
      <h2 style="margin:.25rem 0">${esc(d.verdict.label)}</h2>
      <p>${esc(d.verdict.rec)}</p>
      <p class="muted" style="margin:0">${esc(a.summary || "")}</p>
    </div>

    ${d.unanswered.map((q) => `
      <div class="card question">
        <div class="small" style="font-weight:700">Answer this first</div>
        <h3 style="margin-top:.25rem">${esc(q.question)}</h3>
        <p class="small muted" style="margin:0">${esc(q.why)}</p>
        <div class="options">${q.options.map((o, i) => `<button class="btn" data-q="${esc(q.id)}" data-i="${i}">${esc(o.label)}</button>`).join("")}</div>
      </div>`).join("")}

    ${(a.openQuestions || []).length ? `
      <div class="card question">
        <div class="small" style="font-weight:700">Questions to ask the client</div>
        <ul>${a.openQuestions.map((q) => `<li><strong>${esc(q.question)}</strong> <span class="muted">${esc(q.why)}</span></li>`).join("")}</ul>
      </div>` : ""}

    <div class="card">
      <h2>Requested capabilities</h2>
      <table class="caps">
        <thead><tr><th style="width:30%">Capability</th><th style="width:18%">Status</th><th>Conditions</th></tr></thead>
        <tbody>${d.requested.map(capRow).join("") || `<tr><td colspan="3" class="muted">No capabilities matched the requirement.</td></tr>`}</tbody>
      </table>
      ${answered.length ? `<p class="small muted" style="margin-top:.75rem">Your answers: ${answered.map((q) => `${esc(q.question)} <strong>${esc(q.options[state.answers[q.id]].label)}</strong> (<button class="linkish" data-reset="${esc(q.id)}">change</button>)`).join("; ")}</p>` : ""}
      ${d.others.length ? `<details style="margin-top:.75rem"><summary>Other capabilities in this guide (${d.others.length})</summary><table class="caps"><tbody>${d.others.map(capRow).join("")}</tbody></table></details>` : ""}
    </div>

    ${alternatives.length ? `
      <div class="card">
        <h2>Alternatives if the exact requirement can't be met</h2>
        ${alternatives.map((x) => `<p><strong>Instead of</strong> ${esc(x.insteadOf)}: ${esc(x.option)}<br><span class="small muted">Does not cover: ${esc(x.doesNotCover)}</span></p>`).join("")}
      </div>` : ""}

    <div class="card">
      <div class="row" style="justify-content:space-between"><h2>Before you start building</h2><button class="linkish" data-goto="blockers">See all blockers →</button></div>
      ${d.openBlockers.length ? `<ul>${d.openBlockers.slice(0, 3).map((b) => `<li><strong>${esc(b.title)}</strong>. ${esc(b.resolution)} <span class="small muted">(${esc(b.who)})</span></li>`).join("")}</ul>` : `<p class="muted">No open blockers for this context.</p>`}
    </div>

    ${a.auth ? `
      <div class="card">
        <h2>Recommended authentication</h2>
        <p><strong>${esc(a.auth.recommended)}</strong></p>
        <p class="muted">${esc(a.auth.why)}</p>
        ${(a.auth.alternatives || []).length ? `<ul class="small">${a.auth.alternatives.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      </div>` : ""}

    <h2>Estimate</h2>
    <div class="grid-3">
      <div class="card"><div class="small muted">Engineering effort</div><h3>${esc(est.engineering?.range || "Unknown")}</h3><p class="small muted">${esc(est.engineering?.assumptions || "")}</p></div>
      <div class="card"><div class="small muted">External waiting time</div><h3>${esc(est.waiting?.range || "Unknown")}</h3><p class="small muted">${esc(est.waiting?.notes || "")}</p></div>
      <div class="card"><div class="small muted">Uncertainty and dependencies</div><ul class="small" style="padding-left:1.1rem;margin:.25rem 0 0">${(est.uncertainty || []).map((u) => `<li>${esc(u)}</li>`).join("") || "<li>None recorded</li>"}</ul></div>
    </div>
    <p class="small muted">Estimates are ranges, not promises. Waiting time runs in parallel with engineering where possible and is controlled by third parties.</p>

    <div class="row" style="margin-top:1rem"><button class="btn primary" data-goto="guide">Next: open the step-by-step guide →</button></div>`;

  body.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    state.answers[b.dataset.q] = Number(b.dataset.i);
    saveState();
    renderAssessment();
  }));
  body.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => {
    delete state.answers[b.dataset.reset];
    saveState();
    renderAssessment();
  }));
  body.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => {
    S.current.tab = b.dataset.goto;
    renderAssessment();
    window.scrollTo(0, 0);
  }));
}

function tabGuide(body) {
  const { assessment: a, state } = S.current;
  const stages = a.guide || [];
  const tasks = stages.flatMap((s) => s.tasks.map((t) => ({ ...t, stage: s.stage })));
  const done = tasks.filter((t) => state.done[t.id]).length;
  const next = tasks.find((t) => !state.done[t.id]);
  const taskHtml = (t) => `
    <div class="task ${state.done[t.id] ? "done" : ""}">
      <input type="checkbox" data-task="${esc(t.id)}" ${state.done[t.id] ? "checked" : ""} aria-label="Mark “${esc(t.title)}” done">
      <div>
        <div class="title"><strong>${esc(t.title)}</strong></div>
        <div>${esc(t.detail)}</div>
        <div class="meta"><span>Who: ${esc(t.who)}</span><span>Done when: ${esc(t.doneWhen)}</span>${safeUrl(t.source) ? `<span>${link(t.source, "Source")}</span>` : ""}</div>
      </div>
    </div>`;

  body.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between"><strong>Progress</strong><span class="muted">${done} of ${tasks.length} tasks</span></div>
      <div class="progress" style="margin-top:.5rem"><div style="width:${tasks.length ? (100 * done) / tasks.length : 0}%"></div></div>
    </div>
    ${next ? `<div class="card next-task"><div class="small muted">Your next task · ${esc(next.stage)}</div>${taskHtml(next)}</div>` : `<div class="card verdict go"><h2>All tasks done 🎉</h2><p>Record your test results in the Evidence tab and share the guide.</p></div>`}
    ${stages.map((s, i) => `
      <details class="card" ${s.tasks.some((t) => t.id === next?.id) ? "open" : ""}>
        <summary>${i + 1}. ${esc(s.stage)} <span class="small muted">(${s.tasks.filter((t) => state.done[t.id]).length}/${s.tasks.length})</span></summary>
        ${s.tasks.map(taskHtml).join("")}
      </details>`).join("")}`;

  body.querySelectorAll("[data-task]").forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) state.done[cb.dataset.task] = true;
    else delete state.done[cb.dataset.task];
    saveState();
    renderAssessment();
  }));
}

function tabBlockers(body, d) {
  const { context, state } = S.current;
  const cls = (s) => (s === "Resolved" ? "resolved" : s === "Accepted limitation" ? "accepted" : s.startsWith("Waiting") ? "waiting" : "");
  const handoff = (b) => (b.handoff || "").replaceAll("{requirement}", context.requirement || "this integration");

  body.innerHTML = d.blockers.length ? d.blockers.map((b) => `
    <div class="card blocker ${cls(b.state)}">
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">${esc(b.title)}</h3>
        <select data-blocker="${esc(b.id)}" aria-label="Status of ${esc(b.title)}" style="width:auto">
          ${BLOCKER_STATES.map((s) => `<option ${s === b.state ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <p style="margin-top:.5rem">${esc(b.detail)}</p>
      <div class="meta"><span>Type: ${esc(b.category)}</span><span>Who acts: ${esc(b.who)}</span></div>
      <p style="margin-top:.5rem"><strong>How to resolve:</strong> ${esc(b.resolution)} ${safeUrl(b.source) ? link(b.source, "Source") : ""}</p>
      ${b.handoff ? `
        <details><summary>Prepared request to send</summary>
          <pre class="notes">${esc(handoff(b))}</pre>
          <button class="btn small" data-copy="${esc(b.id)}">Copy request</button>
        </details>` : ""}
    </div>`).join("") : `<div class="card"><p class="muted">No blockers apply to this context.</p></div>`;

  body.querySelectorAll("[data-blocker]").forEach((sel) => sel.addEventListener("change", () => {
    state.blockerStates[sel.dataset.blocker] = sel.value;
    saveState();
    renderAssessment();
  }));
  body.querySelectorAll("[data-copy]").forEach((btn) => btn.addEventListener("click", () =>
    copy(handoff(d.blockers.find((b) => b.id === btn.dataset.copy)))));
}

const TEST_RESULTS = [
  "Passed — behaviour confirmed",
  "Failed — authorization or permission error",
  "Failed — capability gap (API can't do it)",
  "Inconclusive",
];

function tabEvidence(body, d) {
  const { assessment: a, state } = S.current;
  const all = [...d.requested, ...d.others].filter((c) => !c.synthetic);
  body.innerHTML = `
    <div class="card notice small">
      Evidence types, strongest first: <strong>tested</strong> (you ran it), <strong>provider-confirmed</strong>, <strong>documented</strong> (official docs say so), <strong>inferred</strong> (likely, but re-check before quoting), <strong>unverified</strong>.
      “Not found in the docs” never counts as “unsupported”.
    </div>
    ${all.map((c) => `
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(c.label)}</h3><span class="chip ${esc(c.status)}">${esc(STATUS_LABEL[c.status])}</span></div>
        ${c.evidence.length ? `<ul style="margin-bottom:0">${c.evidence.map((e) => `<li><span class="chip ev">${esc(e.type)}</span> ${safeUrl(e.url) ? link(e.url, e.title) : esc(e.title)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">No evidence recorded yet.</p>`}
      </div>`).join("")}

    <form class="card stack" id="test-form">
      <h2>Record a test result</h2>
      <p class="small muted" style="margin:0">Ran a safe test (for example in a sandbox)? Record what happened so the assessment is based on proof. Never paste access tokens or secrets.</p>
      <div class="grid-3">
        <div><label class="field" for="t-cap">Capability</label><select id="t-cap">${all.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("")}</select></div>
        <div><label class="field" for="t-res">Result</label><select id="t-res">${TEST_RESULTS.map((r) => `<option>${esc(r)}</option>`).join("")}</select></div>
        <div><label class="field" for="t-note">What did you observe?</label><input type="text" id="t-note" placeholder="e.g. HTTP 200, message deleted"></div>
      </div>
      <div><button class="btn primary" type="submit">Add result</button></div>
    </form>

    ${(a.sources || []).length ? `
      <details class="card"><summary>All sources consulted by live research (${a.sources.length})</summary>
        <ul>${a.sources.map((s) => `<li>${link(s.url, s.title)}</li>`).join("")}</ul>
      </details>` : ""}
    ${a.researchNotes ? `<details class="card"><summary>Raw research notes</summary><pre class="notes">${esc(a.researchNotes)}</pre></details>` : ""}`;

  body.querySelector("#test-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.tests.push({
      capability: body.querySelector("#t-cap").value,
      result: body.querySelector("#t-res").value,
      note: body.querySelector("#t-note").value.trim().slice(0, 300),
      date: new Date().toISOString().slice(0, 10),
    });
    saveState();
    toast("Test result recorded");
    renderAssessment();
  });
}

function toMarkdown(d) {
  const { assessment: a, context, state } = S.current;
  const lines = [];
  const L = (s = "") => lines.push(s);
  L(`# ${a.provider} integration readiness report`);
  L(`Last checked: ${a.lastVerified || "unknown"} · Source: ${TIER[a.tier].label}`);
  L();
  L("## 1. Executive summary");
  L(`**Requirement:** ${context.requirement || "Not specified"}`);
  L(`**Users:** ${AUDIENCE[context.audience] || "Not specified"} · **Runs:** ${RUNTIME[context.runtime] || "Not specified"}`);
  L();
  L(`**Verdict: ${d.verdict.label}.** ${d.verdict.rec}`);
  L();
  L(a.summary || "");
  L();
  L("## 2. Requirements coverage");
  L("| Capability | Status | Conditions |");
  L("|---|---|---|");
  for (const c of d.requested) L(`| ${c.label} | ${STATUS_LABEL[c.status]} | ${(c.conditions || "").replace(/\|/g, "/")} |`);
  for (const q of a.clarifications || []) {
    const ans = state.answers[q.id];
    L();
    L(`- ${q.question} **${ans === undefined ? "Not answered yet" : q.options[ans].label}**`);
  }
  L();
  L("## 3. Prerequisites and costs");
  for (const b of d.blockers) L(`- **${b.title}** [${b.state}]: ${b.detail} *Resolution:* ${b.resolution} (${b.who})`);
  L();
  L(`- Engineering effort: ${a.estimate?.engineering?.range || "unknown"} (${a.estimate?.engineering?.assumptions || ""})`);
  L(`- External waiting: ${a.estimate?.waiting?.range || "unknown"} (${a.estimate?.waiting?.notes || ""})`);
  for (const u of a.estimate?.uncertainty || []) L(`- Uncertainty: ${u}`);
  L();
  L("## 4. Implementation guide");
  if (a.auth) L(`**Authentication:** ${a.auth.recommended}. ${a.auth.why}`);
  for (const s of (a.guide || []).slice(0, 5)) {
    L();
    L(`### ${s.stage}`);
    for (const t of s.tasks) L(`- [${state.done[t.id] ? "x" : " "}] **${t.title}**: ${t.detail} *(Who: ${t.who}. Done when: ${t.doneWhen})*`);
  }
  L();
  L("## 5. Approval and production readiness");
  for (const s of (a.guide || []).slice(5)) for (const t of s.tasks) L(`- [${state.done[t.id] ? "x" : " "}] **${t.title}**: ${t.detail}`);
  L();
  L("## 6. Evidence and handoffs");
  for (const c of d.requested) for (const e of c.evidence) L(`- ${c.label}: [${e.type}] ${e.title}${e.url ? ` (${e.url})` : ""}`);
  const open = d.openBlockers.map((b) => b.title);
  L();
  L(`Outstanding actions: ${open.length ? open.join("; ") : "none"}`);
  L();
  L("_No credentials, tokens or private notes are included in this report. Provider rules change: re-check before relying on this after the date above._");
  return lines.join("\n");
}

function tabShare(body, d) {
  const { assessment, context, state, shareId } = S.current;
  const url = shareId ? `${location.origin}/#/guide/${shareId}` : "";
  body.innerHTML = `
    <div class="card stack">
      <h2>Share this guide</h2>
      <p class="muted">Create a link for your client, admin or teammate. They see the same assessment, and checklist progress and blocker states stay in sync.</p>
      ${url ? `<div class="row"><input type="text" readonly value="${esc(url)}" id="share-url" style="flex:1;min-width:220px"><button class="btn" id="copy-link">Copy link</button></div>`
            : `<div><button class="btn primary" id="make-link">Create share link</button></div>`}
      <p class="small muted">Included: assessment, sources, your answers, progress and test results. Not included: credentials or tokens (this app never asks for them).
      The link works for anyone who can reach this server. On your own computer that means only you, until you deploy it.</p>
    </div>
    <div class="card stack">
      <h2>Download a report</h2>
      <p class="muted">A Markdown document with the six report sections: summary, coverage, prerequisites, guide, production readiness, and evidence.</p>
      <div class="row"><button class="btn" id="download">Download report (.md)</button><button class="btn" id="copy-md">Copy as text</button></div>
    </div>`;

  body.querySelector("#make-link")?.addEventListener("click", async () => {
    try {
      const { id } = await api("/api/guides", { method: "POST", body: { assessment, context, state } });
      S.current.shareId = id;
      history.replaceState(null, "", `#/guide/${id}`);
      renderAssessment();
      toast("Share link created");
    } catch (err) {
      toast(err.message);
    }
  });
  body.querySelector("#copy-link")?.addEventListener("click", () => copy(url));
  body.querySelector("#copy-md").addEventListener("click", () => copy(toMarkdown(d)));
  body.querySelector("#download").addEventListener("click", () => {
    const blob = new Blob([toMarkdown(d)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${assessment.id}-readiness-report.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- apps without a researched guide ----------
function renderUnresearched() {
  const { assessment: a, context } = S.current;
  const tier = TIER[a.tier];
  app.innerHTML = `
    <p class="small"><a href="#/">← New assessment</a></p>
    <div class="row" style="justify-content:space-between">
      <h1>${esc(a.provider)}</h1>
      <span class="chip ${tier.cls}">${esc(tier.label)}</span>
    </div>
    ${context.requirement ? `<div class="card"><div class="small muted">Client requirement</div><p style="margin:.25rem 0 0;font-weight:550">${esc(context.requirement)}</p></div>` : ""}
    <div class="card stack">
      <h2>We haven't researched ${esc(a.provider)} yet</h2>
      <p class="muted">Rather than guess, the copilot only shows a feasibility verdict when it has evidence.</p>
      ${a.docsUrl || a.authHint ? `
        <table class="caps"><tbody>
          ${a.docsUrl ? `<tr><td style="width:35%">Developer docs</td><td>${link(a.docsUrl)}</td></tr>` : ""}
          ${a.authHint ? `<tr><td>Typical authentication</td><td>${esc(a.authHint)} <span class="chip unverified">unverified</span></td></tr>` : ""}
          <tr><td>Category</td><td>${esc(a.category || "—")}</td></tr>
        </tbody></table>` : ""}
      ${S.config.liveResearch
        ? `<div class="row"><button class="btn primary" id="research">Run live research</button><span class="small muted">Claude reads the official docs with web search. Takes about 1–3 minutes and uses your API credits.</span></div>`
        : `<div class="notice">Live research is off. Add an Anthropic API key to the <code>.env</code> file and restart the app (see README, step 5) to research any app on demand.</div>`}
    </div>
    <div class="card">
      <h2>What the research answers, in this order</h2>
      <ol>
        <li><strong>Can it do what I need?</strong> Each requested operation, with restrictions.</li>
        <li><strong>Can I access it?</strong> Plans, billing, app creation, admin rights.</li>
        <li><strong>Can I launch it?</strong> Reviews, verification, marketplace rules.</li>
        <li><strong>How do I build it?</strong> Auth method, scopes, setup steps.</li>
        <li><strong>How do I prove it works?</strong> Safe tests for each operation.</li>
      </ol>
    </div>`;
  document.getElementById("research")?.addEventListener("click", () => runResearch());
}

async function runResearch() {
  const { assessment: a, context } = S.current;
  const steps = ["Searching official API references", "Checking access, plans and approvals", "Mapping authentication and setup", "Structuring the assessment"];
  app.innerHTML = `
    <div class="loading card">
      <div class="spinner"></div>
      <h2>Researching ${esc(a.provider)}…</h2>
      <p class="muted">Usually 1–3 minutes. Please keep this tab open.</p>
      <ol class="steps">${steps.map((s, i) => `<li data-step="${i}">${esc(s)}</li>`).join("")}</ol>
    </div>`;
  let i = 0;
  const tick = () => app.querySelectorAll("[data-step]").forEach((li) => {
    const n = Number(li.dataset.step);
    li.className = n < i ? "done" : n === i ? "active" : "";
  });
  tick();
  const timer = setInterval(() => { if (i < steps.length - 1) { i++; tick(); } }, 25000);
  try {
    const result = await api("/api/research", {
      method: "POST",
      body: { id: a.id, provider: a.provider, docsUrl: a.docsUrl, requirement: context.requirement, audience: context.audience, runtime: context.runtime },
    });
    S.current.assessment = result;
    S.current.state = storage.get(stateKey(result.id, context.requirement)) || emptyState();
    S.current.tab = "feasibility";
    S.apps = await api("/api/apps");
    renderAssessment();
  } catch (err) {
    app.innerHTML = `<div class="error">${esc(err.message)}</div><p style="margin-top:1rem"><button class="btn" id="back">Back</button></p>`;
    document.getElementById("back").addEventListener("click", () => renderAssessment());
  } finally {
    clearInterval(timer);
  }
}

// ---------- boot ----------
async function route() {
  const { route: r, params } = parseHash();
  window.scrollTo(0, 0);
  if (r.startsWith("/guide/")) return openShared(r.slice(7));
  if (r === "/assess" && params.get("app")) return openAssessment(params);
  renderHome(params);
}

async function boot() {
  try {
    [S.config, S.apps] = await Promise.all([api("/api/config"), api("/api/apps")]);
  } catch {
    app.innerHTML = `<div class="error">Can't reach the app server. Is it still running in your terminal window?</div>`;
    return;
  }
  const pill = document.getElementById("live-pill");
  pill.textContent = S.config.liveResearch ? "Live research: on" : "Live research: off";
  pill.className = `pill ${S.config.liveResearch ? "on" : ""}`;
  window.addEventListener("hashchange", route);
  route();
}

boot();
