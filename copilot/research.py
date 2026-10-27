"""Live research with Gemini for apps that have no researched guide.

Step 1: Gemini researches the official docs using Google Search grounding.
Step 2: Gemini turns those notes into the same JSON shape as data/curated/*.json.
If the key's free tier doesn't allow Search grounding, step 1 falls back to the
model's own knowledge and every claim is downgraded so the UI never overstates it.
"""
import datetime
import json

from google import genai
from google.genai import errors, types

# Tried in order. "-latest" aliases follow Google's newest Flash models, which are the
# ones the free tier covers; if a model is missing or out of free quota we try the next.
DEFAULT_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"]

STATUS = ["supported", "conditional", "unsupported", "unverified"]
EVIDENCE = ["documented", "tested", "provider-confirmed", "inferred", "unverified"]


def _obj(properties):
    return {"type": "object", "properties": properties, "required": list(properties)}


_str = {"type": "string"}
_str_list = {"type": "array", "items": _str}

SCHEMA = _obj({
    "provider": _str,
    "product": _str,
    "summary": _str,
    "capabilities": {"type": "array", "items": _obj({
        "id": _str,
        "resource": _str,
        "op": {"type": "string", "enum": ["create", "read", "update", "delete", "other"]},
        "label": _str,
        "method": _str,
        "status": {"type": "string", "enum": STATUS},
        "conditions": _str,
        "evidence": {"type": "array", "items": _obj({
            "type": {"type": "string", "enum": EVIDENCE}, "title": _str, "url": _str,
        })},
    })},
    "openQuestions": {"type": "array", "items": _obj({"question": _str, "why": _str})},
    "auth": _obj({"recommended": _str, "why": _str, "alternatives": _str_list}),
    "blockers": {"type": "array", "items": _obj({
        "id": _str,
        "title": _str,
        "category": {"type": "string", "enum": ["capability", "access", "auth", "approval", "cost"]},
        "detail": _str,
        "who": _str,
        "resolution": _str,
    })},
    "alternatives": {"type": "array", "items": _obj({"insteadOf": _str, "option": _str, "doesNotCover": _str})},
    "estimate": _obj({
        "engineering": _obj({"range": _str, "assumptions": _str}),
        "waiting": _obj({"range": _str, "notes": _str}),
        "uncertainty": _str_list,
    }),
    "guide": {"type": "array", "items": _obj({
        "stage": _str,
        "tasks": {"type": "array", "items": _obj({
            "id": _str, "title": _str, "detail": _str, "who": _str, "doneWhen": _str, "source": _str,
        })},
    })},
})

RESEARCH_SYSTEM = """You are the research step of an Integration Readiness Copilot. A developer must decide whether an integration is feasible before investing engineering time.

Investigate, in this order:
1. Can the provider's API do each requested operation? Note ownership, plan, role or resource restrictions.
2. Can the developer access it? Plans/billing, app creation, admin rights, network restrictions.
3. Can they launch it? App review, verification, marketplace or security requirements.
4. How do they build it? Auth method, scopes, credentials, token lifetime, key setup steps.

Evidence rules:
- Prefer official API references and official developer guides. Community posts can hint at problems but never establish a fact alone.
- "Not found in the docs" is NOT the same as "unsupported". Say what you looked for and mark it unverified.
- Be specific: exact method/endpoint and scope names where you find them.
- After each material claim, write the full official URL of the page it came from.
Write concise research notes, organised by the four questions."""

STRUCTURE_SYSTEM = """Convert integration research notes into the required JSON. Rules:
- Use only facts in the notes. Never invent endpoints, scopes or URLs. Evidence URLs must appear in the notes; use "" if none.
- status: "supported" = official source confirms under stated conditions; "conditional" = available only with specific scopes/roles/ownership/plans; "unsupported" = the investigated API surface has no documented way (say what was checked in conditions); "unverified" = evidence missing or contradictory.
- Mark evidence type "documented" only when an official source is cited for it; otherwise "inferred" or "unverified".
- One capability per requested operation, ids like "cap-1". Add openQuestions for ambiguities that would change the outcome (max 3).
- guide must use exactly these stages in order: Prerequisites, Choose authentication, Configure the app, Implement the connector, Test the required behavior, Prepare for production. 1-3 tasks each, plain language, ids like "t-1". Use "" for source when there is none.
- Estimates are ranges with assumptions; keep engineering effort separate from external waiting time."""


class ResearchError(Exception):
    """A problem worth showing to the user as-is."""


def describe_context(requirement, audience, runtime):
    who = {"internal": "the developer's own team", "external": "external customers or multiple tenants"}.get(audience, "not specified")
    how = {
        "interactive": "during an interactive user session",
        "background": "as a background automation or AI agent",
        "both": "both interactively and in the background",
    }.get(runtime, "not decided yet")
    req = requirement or "(none given — assess the most common integration use cases)"
    return f"Client requirement: {req}\nWho will use it: {who}\nHow it will run: {how}"


def _friendly(err):
    code = getattr(err, "code", None)
    if code in (401, 403) or "API_KEY_INVALID" in str(err):
        return ResearchError("Google rejected the Gemini API key. Check that you copied the whole key from Google AI Studio.")
    if code == 429:
        return ResearchError("The free Gemini quota is used up for now (free keys have per-minute and per-day limits). Wait a minute and try again, or try again tomorrow.")
    return ResearchError(f"Gemini returned an error: {err}")


def _generate(client, models, contents, config):
    """Try each model in turn; move on when a model is missing or out of free quota."""
    last = None
    for model in models:
        try:
            return client.models.generate_content(model=model, contents=contents, config=config), model
        except errors.ClientError as err:
            last = err
            if err.code in (404, 429):
                continue
            raise
    raise last


def run_live_research(provider, api_key, *, app_id, category="", docs_url="", requirement="", audience="", runtime="",
                      models=None, client=None):
    client = client or genai.Client(api_key=api_key)
    models = models or DEFAULT_MODELS
    context = describe_context(requirement, audience, runtime)
    prompt = f"Provider: {provider}{f' (developer docs: {docs_url})' if docs_url else ''}\n{context}"

    # Step 1: grounded research. Fall back to ungrounded if Search isn't available on this key.
    grounded = True
    try:
        try:
            research, model = _generate(client, models, prompt, types.GenerateContentConfig(
                system_instruction=RESEARCH_SYSTEM,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ))
        except errors.ClientError as err:
            if err.code not in (400, 403, 429):
                raise
            grounded = False
            research, model = _generate(client, models, prompt, types.GenerateContentConfig(system_instruction=RESEARCH_SYSTEM))
        notes = research.text or ""
        if not notes.strip():
            raise ResearchError("Gemini returned no findings. Try again, or describe the requirement in more detail.")

        sources = []
        candidate = (research.candidates or [None])[0]
        chunks = getattr(getattr(candidate, "grounding_metadata", None), "grounding_chunks", None) or []
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if web and web.uri and all(s["url"] != web.uri for s in sources):
                sources.append({"url": web.uri, "title": web.title or web.domain or web.uri})

        # Step 2: structure the notes into the assessment JSON.
        structured, _ = _generate(client, [model], f"{context}\n\nResearch notes:\n{notes}", types.GenerateContentConfig(
            system_instruction=STRUCTURE_SYSTEM,
            response_mime_type="application/json",
            response_json_schema=SCHEMA,
        ))
    except errors.APIError as err:
        raise _friendly(err) from err

    try:
        assessment = json.loads(structured.text)
    except (TypeError, json.JSONDecodeError) as err:
        raise ResearchError("Gemini's answer couldn't be read. Please try again.") from err

    if not grounded:
        # Without web search there is no fresh source: never present claims as documented.
        for cap in assessment.get("capabilities", []):
            for ev in cap.get("evidence", []):
                if ev.get("type") in ("documented", "provider-confirmed"):
                    ev["type"] = "inferred"
        assessment["summary"] = ("Not checked against live documentation (web search isn't available on this API key), "
                                 "so treat every claim as a lead to verify. " + assessment.get("summary", ""))

    return {
        **assessment,
        "id": app_id,
        "category": category,
        "tier": "live",
        "lastVerified": datetime.date.today().isoformat(),
        "defaultRequirement": requirement,
        "clarifications": [],
        "researchNotes": notes,
        "sources": sources,
        "grounded": grounded,
        "model": model,
    }
