// Smoke test: starts the server, exercises every API route, and runs the live-research
// pipeline against a fake Claude client (no API key or network needed).
import { spawn } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";
import { runLiveResearch } from "../research.js";

const PORT = 3999;
const base = `http://localhost:${PORT}`;
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

// --- live research pipeline with a fake client ---
const fakeAssessment = {
  provider: "Acme", product: "Acme API", summary: "Test summary",
  capabilities: [{ id: "c1", resource: "Widgets", op: "read", label: "Read widgets", method: "GET /widgets", status: "supported", conditions: "Needs read scope", evidence: [{ type: "documented", title: "Docs", url: "https://acme.test/docs" }] }],
  openQuestions: [], auth: { recommended: "OAuth 2.0", why: "Only option", alternatives: [] },
  blockers: [], alternatives: [],
  estimate: { engineering: { range: "1 day", assumptions: "x" }, waiting: { range: "0", notes: "" }, uncertainty: [] },
  guide: [{ stage: "Prerequisites", tasks: [{ id: "t1", title: "Sign up", detail: "", who: "Developer", doneWhen: "Done", source: "" }] }],
};
const calls = [];
const fakeClient = {
  beta: {
    messages: {
      async create(params) {
        calls.push(params);
        if (calls.length === 1) {
          return { stop_reason: "pause_turn", content: [
            { type: "web_search_tool_result", content: [{ url: "https://acme.test/docs", title: "Acme docs" }] },
            { type: "text", text: "Acme supports reading widgets. ", citations: [{ url: "https://acme.test/docs", title: "Acme docs" }] },
          ] };
        }
        if (calls.length === 2) return { stop_reason: "end_turn", content: [{ type: "text", text: "Auth is OAuth 2.0." }] };
        return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(fakeAssessment) }] };
      },
    },
  },
};

console.log("Live research pipeline (fake Claude):");
await check("resumes paused turns, then structures the notes", async () => {
  const result = await runLiveResearch({ id: "acme", provider: "Acme", requirement: "Read widgets", audience: "external", runtime: "background" }, fakeClient);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].messages.at(-1).role, "assistant", "paused turn is sent back");
  assert.ok(calls[0].tools[0].type.startsWith("web_search"));
  assert.equal(calls[2].output_config.format.type, "json_schema");
  assert.equal(result.tier, "live");
  assert.equal(result.sources[0].url, "https://acme.test/docs");
  assert.match(result.researchNotes, /OAuth/);
});

await check("surfaces refusals instead of crashing on empty content", async () => {
  const refusing = { beta: { messages: { create: async () => ({ stop_reason: "refusal", stop_details: { explanation: "test" }, content: [] }) } } };
  await assert.rejects(runLiveResearch({ id: "x", provider: "X" }, refusing), /declined/);
});

// --- HTTP API ---
console.log("Server API:");
const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: "" },
  stdio: "pipe",
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("running") && resolve());
  server.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
});
const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const send = (method, p, body) => fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

await check("serves the UI", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Integration Readiness Copilot/);
});
await check("blocks path traversal", async () => {
  const r = await fetch(base + "/..%2Fserver.js");
  assert.equal(r.status, 404);
});
await check("lists 100+ apps with 4 researched guides", async () => {
  const { body } = await get("/api/apps");
  assert.ok(body.length >= 100, `only ${body.length} apps`);
  assert.equal(body.filter((a) => a.tier === "curated").length, 4);
});
await check("every curated guide has the required sections", async () => {
  for (const id of ["slack", "google-drive", "shopify", "mongodb-atlas"]) {
    const { body } = await get(`/api/apps/${id}`);
    for (const key of ["capabilities", "blockers", "guide", "estimate", "auth", "clarifications"]) assert.ok(body[key], `${id} missing ${key}`);
    assert.equal(body.guide.length, 6, `${id} should have 6 guide stages`);
    for (const c of body.capabilities) assert.ok(["supported", "conditional", "unsupported", "unverified"].includes(c.status), `${id}/${c.id} bad status`);
  }
});
await check("directory app returns an unresearched entry", async () => {
  const { body } = await get("/api/apps/notion");
  assert.equal(body.tier, "directory");
});
await check("unknown app is a 404", async () => assert.equal((await get("/api/apps/not-a-real-app")).status, 404));
await check("live research without a key explains how to turn it on", async () => {
  const r = await send("POST", "/api/research", { provider: "Notion" });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /ANTHROPIC_API_KEY/);
});
await check("share link round trip (create, read, update progress)", async () => {
  const created = await send("POST", "/api/guides", { assessment: { id: "slack" }, context: { requirement: "x" }, state: { done: {} } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  await send("PUT", `/api/guides/${id}`, { state: { done: { "s-p1": true } } });
  const read = await get(`/api/guides/${id}`);
  assert.equal(read.body.state.done["s-p1"], true);
  fs.rmSync(new URL(`../data/shared/${id}.json`, import.meta.url));
});

server.kill();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
