// Live research for apps that have no curated guide.
// Step 1: Claude researches the official docs with web search (citations kept).
// Step 2: Claude turns those notes into the same JSON shape as data/curated/*.json.
// Two steps because structured JSON output can't be combined with citations in one call.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const STATUS = ["supported", "conditional", "unsupported", "unverified"];
const EVIDENCE = ["documented", "tested", "provider-confirmed", "inferred", "unverified"];

const str = { type: "string" };
const strArr = { type: "array", items: str };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const SCHEMA = obj({
  provider: str,
  product: str,
  summary: str,
  capabilities: {
    type: "array",
    items: obj({
      id: str,
      resource: str,
      op: { type: "string", enum: ["create", "read", "update", "delete", "other"] },
      label: str,
      method: str,
      status: { type: "string", enum: STATUS },
      conditions: str,
      evidence: {
        type: "array",
        items: obj({ type: { type: "string", enum: EVIDENCE }, title: str, url: str }),
      },
    }),
  },
  openQuestions: {
    type: "array",
    items: obj({ question: str, why: str }),
  },
  auth: obj({ recommended: str, why: str, alternatives: strArr }),
  blockers: {
    type: "array",
    items: obj({
      id: str,
      title: str,
      category: { type: "string", enum: ["capability", "access", "auth", "approval", "cost"] },
      detail: str,
      who: str,
      resolution: str,
    }),
  },
  alternatives: {
    type: "array",
    items: obj({ insteadOf: str, option: str, doesNotCover: str }),
  },
  estimate: obj({
    engineering: obj({ range: str, assumptions: str }),
    waiting: obj({ range: str, notes: str }),
    uncertainty: strArr,
  }),
  guide: {
    type: "array",
    items: obj({
      stage: str,
      tasks: {
        type: "array",
        items: obj({ id: str, title: str, detail: str, who: str, doneWhen: str, source: str }),
      },
    }),
  },
});

const RESEARCH_SYSTEM = `You are the research step of an Integration Readiness Copilot. A developer must decide whether an integration is feasible before investing engineering time.

Investigate, in this order:
1. Can the provider's API do each requested operation? Note ownership, plan, role or resource restrictions.
2. Can the developer access it? Plans/billing, app creation, admin rights, network restrictions.
3. Can they launch it? App review, verification, marketplace or security requirements.
4. How do they build it? Auth method, scopes, credentials, token lifetime, key setup steps.

Evidence rules:
- Prefer official API references and official developer guides. Community posts can hint at problems but never establish a fact alone.
- "Not found in the docs" is NOT the same as "unsupported". Say what you searched and mark it unverified.
- Be specific about conditions. Include the exact method/endpoint and scope names where you find them.
- Include the source URL for every material claim.
Write concise research notes, organised by the four questions.`;

const STRUCTURE_SYSTEM = `Convert integration research notes into the required JSON. Rules:
- Use only facts in the notes. Never invent endpoints, scopes or URLs. Evidence URLs must come from the notes or source list.
- status: "supported" = official source confirms under stated conditions; "conditional" = available only with specific scopes/roles/ownership/plans; "unsupported" = the investigated API surface has no documented way (say what was checked in conditions); "unverified" = evidence missing or contradictory.
- Mark evidence type "documented" only when an official source states it; otherwise "inferred" or "unverified".
- Add one capability per requested operation. Add openQuestions for ambiguities that would change the outcome (max 3).
- guide must use exactly these stages in order: Prerequisites, Choose authentication, Configure the app, Implement the connector, Test the required behavior, Prepare for production. 1-3 tasks each, plain language. Use "" for source when there is none.
- Estimates are ranges with assumptions; keep engineering effort separate from external waiting time.`;

// Server-side refusal fallback is on by default; if the account/API rejects the
// beta parameter, retry once without it so the prototype still works.
async function create(client, params) {
  try {
    return await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      return client.beta.messages.create(params);
    }
    throw err;
  }
}

function checkRefusal(response) {
  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation || "no explanation given";
    throw new Error(`Claude declined this research request (${why}).`);
  }
}

export function describeContext({ requirement, audience, runtime }) {
  const who = { internal: "the developer's own team", external: "external customers or multiple tenants" }[audience] || "not specified";
  const how = {
    interactive: "during an interactive user session",
    background: "as a background automation or AI agent",
    both: "both interactively and in the background",
  }[runtime] || "not decided yet";
  return `Client requirement: ${requirement || "(none given — assess the most common integration use cases)"}\nWho will use it: ${who}\nHow it will run: ${how}`;
}

export async function runLiveResearch(input, client = new Anthropic()) {
  const context = describeContext(input);

  // Step 1: research with web search. Loop while the server pauses a long tool turn.
  const messages = [
    {
      role: "user",
      content: `Provider: ${input.provider}${input.docsUrl ? ` (developer docs: ${input.docsUrl})` : ""}\n${context}`,
    },
  ];
  const sources = new Map();
  let notes = "";
  for (let turn = 0; turn < 5; turn++) {
    const response = await create(client, {
      model: MODEL,
      max_tokens: 16000,
      system: RESEARCH_SYSTEM,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages,
    });
    checkRefusal(response);
    for (const block of response.content) {
      if (block.type === "text") {
        notes += block.text;
        for (const c of block.citations ?? []) {
          if (c.url) sources.set(c.url, c.title || c.url);
        }
      }
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url && !sources.has(r.url)) sources.set(r.url, r.title || r.url);
      }
    }
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (!notes.trim()) throw new Error("Research returned no findings.");

  // Step 2: structure the notes into the assessment JSON.
  const sourceList = [...sources].map(([url, title]) => `- ${title}: ${url}`).join("\n");
  const structured = await create(client, {
    model: MODEL,
    max_tokens: 16000,
    system: STRUCTURE_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${context}\n\nResearch notes:\n${notes}\n\nSources consulted:\n${sourceList || "(none)"}`,
      },
    ],
  });
  checkRefusal(structured);
  if (structured.stop_reason === "max_tokens") throw new Error("The structured result was cut off. Try a narrower requirement.");
  const text = structured.content.find((b) => b.type === "text")?.text;
  const assessment = JSON.parse(text);

  return {
    ...assessment,
    id: input.id,
    category: input.category || "",
    tier: "live",
    lastVerified: new Date().toISOString().slice(0, 10),
    defaultRequirement: input.requirement || "",
    clarifications: [],
    researchNotes: notes,
    sources: [...sources].map(([url, title]) => ({ url, title })),
  };
}
