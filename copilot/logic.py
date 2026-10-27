"""Product logic with no UI: loading the library, understanding the requirement,
and combining a guide with the developer's answers into a feasibility verdict."""
import base64
import copy
import json
import re
import zlib
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

STATUS_LABEL = {
    "supported": "Supported",
    "conditional": "Conditionally supported",
    "unsupported": "Unsupported",
    "unverified": "Unverified",
}
STATUS_COLOR = {"supported": "green", "conditional": "orange", "unsupported": "red", "unverified": "gray"}
BLOCKER_STATES = ["Open", "Waiting for developer", "Waiting for external party", "Resolved", "Accepted limitation"]
AUDIENCE = {"internal": "My own team", "external": "External customers or multiple tenants"}
RUNTIME = {
    "interactive": "During an interactive user session",
    "background": "As a background automation or AI agent",
    "both": "Both",
    "unsure": "I'm not sure yet",
}
TIER = {
    "curated": ("Researched guide", "green"),
    "live": ("Live research · needs human review", "violet"),
    "directory": ("Directory entry · not researched", "gray"),
    "unknown": ("New app · not in library", "gray"),
}
TEST_RESULTS = [
    "Passed — behaviour confirmed",
    "Failed — authorization or permission error",
    "Failed — capability gap (API can't do it)",
    "Inconclusive",
]


def slug(text):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", str(text).lower()))[:60]


# ---------- library ----------
def load_directory():
    return json.loads((DATA / "directory.json").read_text())


def load_curated(app_id):
    file = DATA / "curated" / f"{app_id}.json"
    return json.loads(file.read_text()) if file.exists() else None


def curated_ids():
    return {f.stem for f in (DATA / "curated").glob("*.json")}


# ---------- state shared through the URL ----------
def empty_state():
    return {"answers": {}, "done": {}, "blockerStates": {}, "tests": []}


def encode_state(state):
    raw = json.dumps(state, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(zlib.compress(raw)).decode().rstrip("=")


def decode_state(token):
    try:
        padded = token + "=" * (-len(token) % 4)
        state = json.loads(zlib.decompress(base64.urlsafe_b64decode(padded)))
        return {**empty_state(), **state}
    except Exception:
        return empty_state()


# ---------- requirement understanding ----------
OP_PATTERNS = {
    "create": re.compile(r"\b(creat|add|post|send|upload|insert|writ|new)\w*", re.I),
    "read": re.compile(r"\b(read|get|list|fetch|view|sync|search|retriev|download|quer|export)\w*", re.I),
    "update": re.compile(r"\b(updat|edit|modif|chang|patch|renam)\w*", re.I),
    "delete": re.compile(r"\b(delet|remov|eras|destroy|trash)\w*", re.I),
}


def detect_ops(text):
    if re.search(r"\bcrud\b", text or "", re.I):
        return ["create", "read", "update", "delete"]
    return [op for op, pattern in OP_PATTERNS.items() if pattern.search(text or "")]


def _stem(word):
    return re.sub(r"s$", "", word.lower())


def derive(assessment, context, state):
    """Combine a guide with the requirement, answers and test results."""
    text = context.get("requirement", "")
    ops = detect_ops(text)
    caps = copy.deepcopy(assessment.get("capabilities", []))
    clarifications = assessment.get("clarifications", [])

    # Answers to clarifying questions override status and conditions.
    for q in clarifications:
        answer = state["answers"].get(q["id"])
        if answer is None:
            continue
        option = q["options"][answer]
        for effect in option.get("effects", []):
            cap = next((c for c in caps if c["id"] == effect["capability"]), None)
            if not cap:
                continue
            if effect.get("hide"):
                cap["hidden"] = True
            if effect.get("status"):
                cap["status"] = effect["status"]
            if effect.get("conditions"):
                cap["conditions"] = effect["conditions"]
            cap["answeredBy"] = option["label"]

    # The developer's own tests are the strongest evidence.
    for t in state["tests"]:
        cap = next((c for c in caps if c["id"] == t["capability"]), None)
        if not cap:
            continue
        note = f" — {t['note']}" if t.get("note") else ""
        cap.setdefault("evidence", []).append({"type": "tested", "title": f"{t['result']}{note} ({t['date']})", "url": ""})
        if t["result"].startswith("Failed — capability gap"):
            cap["status"] = "unsupported"
            cap["conditions"] = f"Your test showed the operation is not available{': ' + t['note'] if t.get('note') else ''}."
        elif t["result"].startswith("Passed") and cap["status"] == "unverified":
            cap["status"] = "conditional"
            cap["conditions"] = "Confirmed by your test. Conditions are not fully documented yet."
        cap["tested"] = True

    # Which capabilities did the client actually ask for?
    resources = list(dict.fromkeys(c["resource"] for c in caps))
    mentioned = [r for r in resources if re.search(rf"\b{re.escape(_stem(r))}", text, re.I)]
    for c in caps:
        resource_ok = not mentioned or c["resource"] in mentioned
        by_keyword = any(k in text.lower() for k in c.get("keywords", []))
        if not text or not ops:
            c["requested"] = c["op"] != "other" or by_keyword
        else:
            c["requested"] = (resource_ok and c["op"] in ops) or by_keyword
        if assessment.get("tier") == "live":
            c["requested"] = True

    # Requested operations the guide doesn't cover become explicit unknowns, never silent gaps.
    # Only with one resource in play: with several we can't tell which verb goes with which noun.
    scope = mentioned or (resources if len(resources) == 1 else [])
    if assessment.get("tier") == "curated" and ops and len(scope) == 1:
        r = scope[0]
        for op in ops:
            if not any(c["resource"] == r and c["op"] == op for c in caps):
                caps.append({
                    "id": f"gap-{slug(r)}-{op}", "resource": r, "op": op, "requested": True, "synthetic": True,
                    "label": f"{op.capitalize()} {r.lower()}", "method": "—", "status": "unverified",
                    "conditions": "Not covered by this researched guide. Check the official API reference or run live research before promising it.",
                    "evidence": [],
                })

    visible = [c for c in caps if not c.get("hidden")]
    requested = [c for c in visible if c["requested"]]
    others = [c for c in visible if not c["requested"]]
    unanswered = [q for q in clarifications if state["answers"].get(q["id"]) is None]

    def applies(b):
        a = b.get("appliesTo", {})
        if a.get("audience") and context.get("audience") and context["audience"] not in a["audience"]:
            return False
        if a.get("runtime") and context.get("runtime") and context["runtime"] not in a["runtime"]:
            return False
        if a.get("answer"):
            return all(state["answers"].get(qid) in idxs for qid, idxs in a["answer"].items())
        return True

    blockers = [{**b, "state": state["blockerStates"].get(b["id"], "Open")} for b in assessment.get("blockers", []) if applies(b)]
    open_blockers = [b for b in blockers if b["state"] not in ("Resolved", "Accepted limitation")]

    statuses = {c["status"] for c in requested}
    if "unsupported" in statuses:
        verdict = ("blocked", "Not feasible as specified",
                   "At least one requested operation is unavailable. Revise the requirement with the client before building. See the alternatives below.")
    elif unanswered or "unverified" in statuses:
        verdict = ("questions", "Answer open questions before building",
                   "Some requested behaviour depends on details we don't know yet. Resolve the questions below first. They change the design.")
    elif "conditional" in statuses:
        verdict = ("conditions", "Feasible with conditions",
                   "Every requested operation is available, under the conditions listed. Confirm them with the client, then follow the guide.")
    else:
        verdict = ("go", "Feasible", "Every requested operation is supported. Follow the guide.")

    return {
        "requested": requested, "others": others, "unanswered": unanswered,
        "blockers": blockers, "open_blockers": open_blockers,
        "verdict": {"cls": verdict[0], "label": verdict[1], "rec": verdict[2]},
    }


def handoff_text(blocker, context):
    return (blocker.get("handoff") or "").replace("{requirement}", context.get("requirement") or "this integration")


def to_markdown(assessment, context, state, d):
    """The six-section shareable report."""
    a = assessment
    est = a.get("estimate", {})
    lines = [
        f"# {a['provider']} integration readiness report",
        f"Last checked: {a.get('lastVerified', 'unknown')} · Source: {TIER[a.get('tier', 'unknown')][0]}",
        "",
        "## 1. Executive summary",
        f"**Requirement:** {context.get('requirement') or 'Not specified'}",
        f"**Users:** {AUDIENCE.get(context.get('audience'), 'Not specified')} · **Runs:** {RUNTIME.get(context.get('runtime'), 'Not specified')}",
        "",
        f"**Verdict: {d['verdict']['label']}.** {d['verdict']['rec']}",
        "",
        a.get("summary", ""),
        "",
        "## 2. Requirements coverage",
        "| Capability | Status | Conditions |",
        "|---|---|---|",
    ]
    for c in d["requested"]:
        lines.append(f"| {c['label']} | {STATUS_LABEL[c['status']]} | {c.get('conditions', '').replace('|', '/')} |")
    for q in a.get("clarifications", []):
        ans = state["answers"].get(q["id"])
        lines += ["", f"- {q['question']} **{'Not answered yet' if ans is None else q['options'][ans]['label']}**"]
    lines += ["", "## 3. Prerequisites and costs"]
    for b in d["blockers"]:
        lines.append(f"- **{b['title']}** [{b['state']}]: {b['detail']} *Resolution:* {b['resolution']} ({b['who']})")
    lines += [
        "",
        f"- Engineering effort: {est.get('engineering', {}).get('range', 'unknown')} ({est.get('engineering', {}).get('assumptions', '')})",
        f"- External waiting: {est.get('waiting', {}).get('range', 'unknown')} ({est.get('waiting', {}).get('notes', '')})",
    ]
    lines += [f"- Uncertainty: {u}" for u in est.get("uncertainty", [])]
    lines += ["", "## 4. Implementation guide"]
    if a.get("auth"):
        lines.append(f"**Authentication:** {a['auth']['recommended']}. {a['auth']['why']}")
    guide = a.get("guide", [])
    for s in guide[:5]:
        lines += ["", f"### {s['stage']}"]
        for t in s["tasks"]:
            mark = "x" if state["done"].get(t["id"]) else " "
            lines.append(f"- [{mark}] **{t['title']}**: {t['detail']} *(Who: {t['who']}. Done when: {t['doneWhen']})*")
    lines += ["", "## 5. Approval and production readiness"]
    for s in guide[5:]:
        for t in s["tasks"]:
            mark = "x" if state["done"].get(t["id"]) else " "
            lines.append(f"- [{mark}] **{t['title']}**: {t['detail']}")
    lines += ["", "## 6. Evidence and handoffs"]
    for c in d["requested"]:
        for e in c.get("evidence", []):
            lines.append(f"- {c['label']}: [{e['type']}] {e['title']}{' (' + e['url'] + ')' if e.get('url') else ''}")
    outstanding = "; ".join(b["title"] for b in d["open_blockers"]) or "none"
    lines += [
        "", f"Outstanding actions: {outstanding}", "",
        "_No credentials, tokens or private notes are included in this report. Provider rules change: re-check before relying on this after the date above._",
    ]
    return "\n".join(lines)
