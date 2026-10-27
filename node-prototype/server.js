// Integration Readiness Copilot: a tiny web server with no framework.
// Serves the UI from public/, the app library from data/, and runs live research.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "data");
const publicDir = path.join(here, "public");

// Load settings from a .env file next to this script (so non-developers can paste a key into a file).
const envFile = path.join(here, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT) || 3000;
const liveResearch = Boolean(process.env.ANTHROPIC_API_KEY);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const safeId = (s) => /^[a-z0-9-]{1,80}$/.test(s || "");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

const directory = readJson(path.join(dataDir, "directory.json"));

function tierOf(id) {
  if (fs.existsSync(path.join(dataDir, "curated", `${id}.json`))) return "curated";
  if (fs.existsSync(path.join(dataDir, "generated", `${id}.json`))) return "live";
  return "directory";
}

function loadApp(id) {
  for (const folder of ["curated", "generated"]) {
    const file = path.join(dataDir, folder, `${id}.json`);
    if (fs.existsSync(file)) return readJson(file);
  }
  const entry = directory.find((a) => a.id === id);
  return entry ? { ...entry, provider: entry.name, tier: "directory" } : null;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(publicDir, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": `${MIME[path.extname(file)] || "application/octet-stream"}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, pathname) {
  const parts = pathname.split("/").filter(Boolean); // ["api", ...]

  if (req.method === "GET" && pathname === "/api/config") {
    return send(res, 200, { liveResearch, model: process.env.CLAUDE_MODEL || "claude-opus-5-5" });
  }

  if (req.method === "GET" && pathname === "/api/apps") {
    const known = new Set(directory.map((a) => a.id));
    const generated = fs.readdirSync(path.join(dataDir, "generated"))
      .filter((f) => f.endsWith(".json") && !known.has(f.slice(0, -5)))
      .map((f) => {
        const a = readJson(path.join(dataDir, "generated", f));
        return { id: a.id, name: a.provider, category: a.category || "Researched", docsUrl: "", authHint: a.auth?.recommended || "" };
      });
    return send(res, 200, [...directory, ...generated].map((a) => ({ ...a, tier: tierOf(a.id) })));
  }

  if (req.method === "GET" && parts[1] === "apps" && parts.length === 3) {
    if (!safeId(parts[2])) return send(res, 400, { error: "Bad app id" });
    const app = loadApp(parts[2]);
    return app ? send(res, 200, app) : send(res, 404, { error: "Unknown app" });
  }

  if (req.method === "POST" && pathname === "/api/research") {
    if (!liveResearch) {
      return send(res, 503, {
        error: "Live research is switched off because no Anthropic API key is set. Add ANTHROPIC_API_KEY to the .env file and restart (see README).",
      });
    }
    const body = await readBody(req);
    const provider = String(body.provider || "").trim().slice(0, 100);
    if (!provider) return send(res, 400, { error: "Tell me which app or provider to research." });
    const id = safeId(body.id) ? body.id : slug(provider);
    const entry = directory.find((a) => a.id === id);
    const { runLiveResearch } = await import("./research.js");
    console.log(`[research] ${provider}: started`);
    const started = Date.now();
    const assessment = await runLiveResearch({
      id,
      provider,
      category: entry?.category,
      docsUrl: entry?.docsUrl || String(body.docsUrl || "").slice(0, 300),
      requirement: String(body.requirement || "").slice(0, 2000),
      audience: body.audience,
      runtime: body.runtime,
    });
    writeJson(path.join(dataDir, "generated", `${id}.json`), assessment);
    console.log(`[research] ${provider}: done in ${Math.round((Date.now() - started) / 1000)}s`);
    return send(res, 200, assessment);
  }

  // Shareable guides: a snapshot of the assessment plus the developer's progress.
  if (parts[1] === "guides") {
    if (req.method === "POST" && parts.length === 2) {
      const body = await readBody(req);
      const id = crypto.randomBytes(6).toString("hex");
      writeJson(path.join(dataDir, "shared", `${id}.json`), { ...body, id, createdAt: new Date().toISOString() });
      return send(res, 201, { id });
    }
    const id = parts[2];
    if (!/^[a-f0-9]{12}$/.test(id || "")) return send(res, 400, { error: "Bad guide id" });
    const file = path.join(dataDir, "shared", `${id}.json`);
    if (!fs.existsSync(file)) return send(res, 404, { error: "Guide not found" });
    if (req.method === "GET") return send(res, 200, readJson(file));
    if (req.method === "PUT") {
      const body = await readBody(req);
      const current = readJson(file);
      const updated = { ...current, state: body.state, updatedAt: new Date().toISOString() };
      writeJson(file, updated);
      return send(res, 200, updated);
    }
  }

  return send(res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (!pathname.startsWith("/api/")) return serveStatic(req, res);
  try {
    await handleApi(req, res, pathname);
  } catch (err) {
    console.error(err);
    const message = err?.status === 401
      ? "Your Anthropic API key was rejected. Check the key in your .env file."
      : err?.message || "Something went wrong";
    send(res, err?.status === 429 ? 429 : 500, { error: message });
  }
});
server.requestTimeout = 10 * 60 * 1000; // live research can take a few minutes

server.listen(PORT, () => {
  console.log(`\nIntegration Readiness Copilot is running.`);
  console.log(`Open this in your browser:  http://localhost:${PORT}\n`);
  console.log(liveResearch
    ? "Live research: ON (Claude + web search will research apps without a curated guide)."
    : "Live research: OFF (no ANTHROPIC_API_KEY). Curated guides and the directory still work.");
  console.log("To stop the app, press Ctrl+C in this window.\n");
});
