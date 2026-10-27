"""Integration Readiness Copilot — Streamlit app.

Flow: requirement -> feasibility -> blockers -> estimate -> guide -> evidence -> share.
Everything a viewer needs (app, requirement, answers, progress) lives in the URL,
so the address bar is always a shareable link.
"""
import datetime
import json
import os
import re
from urllib.parse import urlencode

import streamlit as st

from copilot.logic import (
    AUDIENCE, BLOCKER_STATES, DATA, RUNTIME, STATUS_COLOR, STATUS_LABEL, TEST_RESULTS, TIER,
    curated_ids, decode_state, derive, empty_state, encode_state, handoff_text, load_curated,
    load_directory, slug, to_markdown,
)

st.set_page_config(page_title="Integration Readiness Copilot", page_icon="🧭", layout="wide")
st.markdown(
    """<style>
    .block-container {max-width: 1100px; padding-top: 2rem;}
    div[data-testid="stMetricValue"] {font-size: 1.4rem;}
    </style>""",
    unsafe_allow_html=True,
)

EXAMPLE_REQUIREMENTS = {
    "notion": "Let users create pages in a Notion database, read and update them, and archive pages that are no longer needed.",
}


def md(text):
    """Escape $ so prices like "$5 to $10" aren't rendered as math."""
    return str(text or "").replace("$", "\\$")


# ---------- data ----------
@st.cache_data
def directory():
    return load_directory()


@st.cache_resource
def research_store():
    """Live research results, shared by everyone using this running app."""
    store = {}
    for f in (DATA / "generated").glob("*.json"):
        store[f.stem] = json.loads(f.read_text())
    return store


def all_apps():
    curated = curated_ids()
    store = research_store()
    apps = []
    for a in directory():
        tier = "curated" if a["id"] in curated else "live" if a["id"] in store else "directory"
        apps.append({**a, "tier": tier})
    known = {a["id"] for a in apps}
    for app_id, a in store.items():
        if app_id not in known:
            apps.append({"id": app_id, "name": a["provider"], "category": a.get("category") or "Researched",
                         "docsUrl": "", "authHint": a.get("auth", {}).get("recommended", ""), "tier": "live"})
    return apps


def load_app(app_id, name):
    guide = load_curated(app_id) or research_store().get(app_id)
    if guide:
        return guide
    entry = next((a for a in directory() if a["id"] == app_id), None)
    if entry:
        return {**entry, "provider": entry["name"], "tier": "directory"}
    return {"id": app_id, "provider": name or app_id, "tier": "unknown"}


# ---------- Gemini key ----------
def gemini_key():
    try:
        key = st.secrets.get("GEMINI_API_KEY", "")
    except Exception:  # no secrets file at all
        key = ""
    return key or os.environ.get("GEMINI_API_KEY", "") or st.session_state.get("user_key", "")


# ---------- navigation (query params are the source of truth) ----------
qp = st.query_params


def reset_widgets():
    """Forget per-assessment widget values (checkboxes, selects) when switching assessments."""
    for key in list(st.session_state):
        if str(key).startswith(("task-", "next-task-", "blocker-")):
            del st.session_state[key]
    st.session_state.pop("state", None)


def open_assessment(app_id, name, req, aud, run):
    reset_widgets()
    qp.clear()
    qp.update({"app": app_id, "name": name, "req": req, "aud": aud, "run": run})


def go_home(**params):
    reset_widgets()
    qp.clear()
    qp.update(params)


def state():
    if "state" not in st.session_state:
        st.session_state.state = decode_state(qp["s"]) if "s" in qp else empty_state()
    return st.session_state.state


def save_state():
    qp["s"] = encode_state(state())


# ---------- sidebar ----------
def sidebar(apps):
    with st.sidebar:
        st.markdown("### 🧭 Integration Readiness Copilot")
        st.caption("Answer the expensive question first: *can it do what the client needs?*")
        st.button("＋ New assessment", on_click=go_home, width="stretch")
        st.divider()
        st.markdown("**Live research (Gemini)**")
        if gemini_key():
            st.success("On. Apps without a guide can be researched.", icon="✅")
        else:
            st.info("Off. Paste a free Gemini API key to research any app.", icon="🔑")
        if not st.session_state.get("key_from_config"):
            st.text_input(
                "Gemini API key", type="password", key="user_key",
                help="Get a free key at https://aistudio.google.com/apikey. It is only kept for this browser session.",
            )
        st.caption("[Get a free key in Google AI Studio](https://aistudio.google.com/apikey)")
        st.divider()
        researched = sum(a["tier"] != "directory" for a in apps)
        st.caption(f"Library: {researched} researched guides · {len(apps)} apps in the directory")


# ---------- home ----------
def home(apps):
    st.title("What are you trying to integrate?")
    st.write("Start with a provider or describe what your client needs. You don't need to know any OAuth terminology.")
    mode = st.segmented_control(
        "Start mode", ["I have a requirement", "I know the app"],
        default="I know the app" if qp.get("mode") == "app" else "I have a requirement",
        label_visibility="collapsed",
    )
    if mode == "I know the app":
        return library(apps)

    names = [a["name"] for a in apps]
    curated = [a for a in apps if a["tier"] == "curated"]

    with st.container(border=True):
        st.markdown("**Try an example**")
        cols = st.columns(len(curated) + 1)
        for col, a in zip(cols, curated + [{"id": "notion", "name": "Notion (unfamiliar app)"}]):
            if col.button(a["name"], key=f"ex-{a['id']}", width="stretch"):
                guide = load_curated(a["id"])
                st.session_state.f_provider = "Notion" if a["id"] == "notion" else a["name"]
                st.session_state.f_req = guide["defaultRequirement"] if guide else EXAMPLE_REQUIREMENTS[a["id"]]

    with st.form("requirement"):
        provider = st.selectbox(
            "Which app or provider?", names, index=None, key="f_provider", accept_new_options=True,
            placeholder="e.g. Slack, Google Drive, or type any app name",
        )
        requirement = st.text_area(
            "What does the client want to accomplish?", key="f_req",
            placeholder="Build a Slack connector that supports creating, reading, updating, and deleting messages.",
        )
        audience = st.radio("Who will use the integration?", list(AUDIENCE), format_func=AUDIENCE.get, horizontal=True, index=1)
        runtime = st.radio("How will it run?", list(RUNTIME), format_func=RUNTIME.get, horizontal=True, index=3)
        if st.form_submit_button("Assess integration", type="primary"):
            if not provider:
                st.error("Tell me which app or provider you want to integrate.")
            else:
                match = next((a for a in apps if a["name"].lower() == provider.lower() or a["id"] == slug(provider)), None)
                open_assessment(match["id"] if match else slug(provider), match["name"] if match else provider,
                                requirement.strip(), audience, runtime)
                st.rerun()


def library(apps):
    c1, c2 = st.columns([3, 2])
    query = c1.text_input("Search the library", placeholder=f"Search {len(apps)} apps by name or category")
    show = c2.segmented_control("Show", ["All", "Researched", "Not researched yet"], default="All")
    q = query.lower()
    shown = [
        a for a in apps
        if (not q or q in a["name"].lower() or q in a["category"].lower())
        and (show in (None, "All") or (show == "Researched") == (a["tier"] != "directory"))
    ]
    shown.sort(key=lambda a: (a["tier"] == "directory", a["name"].lower()))
    if not shown:
        st.info(f"No apps match “{query}”. Type the name under “I have a requirement” to research it.")
    cols = st.columns(4)
    for i, a in enumerate(shown):
        with cols[i % 4].container(border=True):
            st.markdown(f"**{a['name']}**")
            st.caption(a["category"])
            label, color = TIER[a["tier"]]
            st.badge(label.split(" · ")[0], color=color)
            st.button("Open", key=f"open-{a['id']}", on_click=open_assessment,
                      args=(a["id"], a["name"], "", "external", "unsure"), width="stretch")


# ---------- assessment ----------
def assessment_page():
    context = {"requirement": qp.get("req", ""), "audience": qp.get("aud", ""), "runtime": qp.get("run", "")}
    a = load_app(qp["app"], qp.get("name"))
    if not context["requirement"] and a.get("defaultRequirement"):
        context["requirement"] = a["defaultRequirement"]

    st.button("← New assessment", on_click=go_home, type="tertiary")
    st.title(f"{a['provider']} connector assessment" if a["tier"] in ("curated", "live") else a["provider"])
    label, color = TIER[a["tier"]]
    with st.container(horizontal=True, vertical_alignment="center"):
        st.badge(label, color=color)
        details = [a.get("product"), f"Last checked {a['lastVerified']}" if a.get("lastVerified") else "", a.get("model")]
        st.caption(" · ".join(x for x in details if x))

    with st.container(border=True):
        st.caption("Client requirement")
        st.markdown(f"**{md(context['requirement']) or 'Not specified: showing all known capabilities'}**")
        st.caption(f"Users: {AUDIENCE.get(context['audience'], 'Not specified')} · Runs: {RUNTIME.get(context['runtime'], 'Not specified')}")
        if a["tier"] == "live" and a.get("defaultRequirement") and a["defaultRequirement"] != context["requirement"]:
            st.info(f"This research was generated for: “{md(a['defaultRequirement'])}”.")
            if gemini_key() and st.button("Re-run research for this requirement"):
                run_research(a, context)

    if a["tier"] in ("directory", "unknown"):
        return unresearched(a, context)

    s = state()
    d = derive(a, context, s)
    tasks = [t for stage in a.get("guide", []) for t in stage["tasks"]]
    done = sum(bool(s["done"].get(t["id"])) for t in tasks)
    tabs = st.tabs([
        "Feasibility",
        f"Guide ({done}/{len(tasks)})",
        f"Blockers ({len(d['open_blockers'])} open)",
        "Evidence",
        "Share",
    ])
    with tabs[0]:
        tab_feasibility(a, d, s)
    with tabs[1]:
        tab_guide(a, s, tasks)
    with tabs[2]:
        tab_blockers(d, s, context)
    with tabs[3]:
        tab_evidence(a, d, s)
    with tabs[4]:
        tab_share(a, context, s, d)


def cap_row(c):
    with st.container(border=True):
        c1, c2, c3 = st.columns([3, 2, 5])
        c1.markdown(f"**{md(c['label'])}**")
        c1.caption(f"`{c['method']}`")
        with c2:
            st.badge(STATUS_LABEL.get(c["status"], c["status"]), color=STATUS_COLOR.get(c["status"], "gray"))
            if c.get("tested"):
                st.badge("tested", color="blue")
        c3.write(md(c.get("conditions")))
        ev = c.get("evidence", [])
        kinds = ", ".join(dict.fromkeys(e["type"] for e in ev))
        note = f"{len(ev)} source{'s' if len(ev) != 1 else ''} · {kinds}" if ev else "No evidence yet"
        c3.caption(note + (" · based on your answer" if c.get("answeredBy") else ""))


def answer(qid, idx):
    state()["answers"][qid] = idx
    save_state()


def reset_answer(qid):
    state()["answers"].pop(qid, None)
    save_state()


def tab_feasibility(a, d, s):
    v = d["verdict"]
    box = {"go": st.success, "conditions": st.warning, "questions": st.info, "blocked": st.error}[v["cls"]]
    box(f"**FEASIBILITY: {v['label']}**\n\n{v['rec']}\n\n{md(a.get('summary'))}")

    for q in d["unanswered"]:
        with st.container(border=True):
            st.markdown(f"**❓ Answer this first: {md(q['question'])}**")
            st.caption(md(q["why"]))
            for i, option in enumerate(q["options"]):
                st.button(option["label"], key=f"q-{q['id']}-{i}", on_click=answer, args=(q["id"], i), width="stretch")

    if a.get("openQuestions"):
        with st.container(border=True):
            st.markdown("**❓ Questions to ask the client**")
            for q in a["openQuestions"]:
                st.markdown(f"- **{md(q['question'])}** {md(q['why'])}")

    st.subheader("Requested capabilities")
    for c in d["requested"]:
        cap_row(c)
    if not d["requested"]:
        st.caption("No capabilities matched the requirement.")
    for q in a.get("clarifications", []):
        if q["id"] in s["answers"]:
            cols = st.columns([5, 1])
            cols[0].caption(f"Your answer to “{q['question']}”: **{q['options'][s['answers'][q['id']]]['label']}**")
            cols[1].button("Change", key=f"reset-{q['id']}", on_click=reset_answer, args=(q["id"],), type="tertiary")
    if d["others"]:
        with st.expander(f"Other capabilities in this guide ({len(d['others'])})"):
            for c in d["others"]:
                cap_row(c)

    if any(c["status"] != "supported" for c in d["requested"]) and a.get("alternatives"):
        st.subheader("Alternatives if the exact requirement can't be met")
        for x in a["alternatives"]:
            st.markdown(f"**Instead of** {md(x['insteadOf'])}: {md(x['option'])}  \n:gray[Does not cover: {md(x['doesNotCover'])}]")

    st.subheader("Before you start building")
    if d["open_blockers"]:
        for b in d["open_blockers"][:3]:
            st.markdown(f"- **{md(b['title'])}.** {md(b['resolution'])} :gray[({md(b['who'])})]")
        st.caption("See every blocker, with ready-to-send requests, in the Blockers tab.")
    else:
        st.caption("No open blockers for this context.")

    if a.get("auth"):
        st.subheader("Recommended authentication")
        st.markdown(f"**{md(a['auth']['recommended'])}**  \n{md(a['auth']['why'])}")
        for alt in a["auth"].get("alternatives", []):
            st.markdown(f"- {md(alt)}")

    st.subheader("Estimate")
    est = a.get("estimate", {})
    c1, c2, c3 = st.columns(3)
    with c1.container(border=True):
        st.metric("Engineering effort", est.get("engineering", {}).get("range", "Unknown"))
        st.caption(md(est.get("engineering", {}).get("assumptions")))
    with c2.container(border=True):
        st.metric("External waiting time", est.get("waiting", {}).get("range", "Unknown"))
        st.caption(md(est.get("waiting", {}).get("notes")))
    with c3.container(border=True):
        st.markdown("**Uncertainty and dependencies**")
        for u in est.get("uncertainty", []) or ["None recorded"]:
            st.caption(f"• {md(u)}")
    st.caption("Estimates are ranges, not promises. Waiting runs in parallel with engineering where possible and is set by third parties.")


def toggle_task(task_id):
    done = state()["done"]
    if st.session_state[f"task-{task_id}"]:
        done[task_id] = True
    else:
        done.pop(task_id, None)
    st.session_state.pop(f"next-task-{task_id}", None)
    save_state()


def task_widget(t, s, key_prefix=""):
    st.checkbox(f"**{t['title']}**", value=bool(s["done"].get(t["id"])), key=f"{key_prefix}task-{t['id']}",
                on_change=toggle_task if not key_prefix else toggle_next, args=(t["id"],))
    st.markdown(md(t["detail"]))
    meta = f"Who: {md(t['who'])} · Done when: {md(t['doneWhen'])}"
    if str(t.get("source", "")).startswith("http"):
        meta += f" · [Source]({t['source']})"
    st.caption(meta)


def toggle_next(task_id):
    if st.session_state[f"next-task-{task_id}"]:
        state()["done"][task_id] = True
        st.session_state.pop(f"task-{task_id}", None)
    save_state()


def tab_guide(a, s, tasks):
    done = sum(bool(s["done"].get(t["id"])) for t in tasks)
    st.progress(done / len(tasks) if tasks else 0, text=f"{done} of {len(tasks)} tasks done")
    stage_of = {t["id"]: stage["stage"] for stage in a.get("guide", []) for t in stage["tasks"]}
    nxt = next((t for t in tasks if not s["done"].get(t["id"])), None)
    if nxt:
        with st.container(border=True):
            st.markdown(f"**👉 Your next task** · {stage_of[nxt['id']]}")
            task_widget(nxt, s, key_prefix="next-")
    else:
        st.success("All tasks done 🎉 Record your test results in the Evidence tab and share the guide.")
    for i, stage in enumerate(a.get("guide", []), 1):
        count = sum(bool(s["done"].get(t["id"])) for t in stage["tasks"])
        with st.expander(f"{i}. {stage['stage']} ({count}/{len(stage['tasks'])})", expanded=nxt is not None and stage_of[nxt["id"]] == stage["stage"]):
            for t in stage["tasks"]:
                task_widget(t, s)


def set_blocker(bid):
    state()["blockerStates"][bid] = st.session_state[f"blocker-{bid}"]
    save_state()


def tab_blockers(d, s, context):
    if not d["blockers"]:
        st.caption("No blockers apply to this context.")
    icon = {"Resolved": "✅", "Accepted limitation": "➖", "Waiting for developer": "⏳", "Waiting for external party": "⏳"}
    for b in d["blockers"]:
        with st.container(border=True):
            c1, c2 = st.columns([3, 2])
            c1.markdown(f"**{icon.get(b['state'], '⚠️')} {md(b['title'])}**")
            c2.selectbox("Status", BLOCKER_STATES, index=BLOCKER_STATES.index(b["state"]), key=f"blocker-{b['id']}",
                         on_change=set_blocker, args=(b["id"],))
            st.write(md(b["detail"]))
            st.caption(f"Type: {b['category']} · Who acts: {md(b['who'])}")
            st.markdown(f"**How to resolve:** {md(b['resolution'])}" + (f" [Source]({b['source']})" if b.get("source") else ""))
            if b.get("handoff"):
                with st.expander("Prepared request to send (copy button on the right)"):
                    st.code(handoff_text(b, context), language=None, wrap_lines=True)


def tab_evidence(a, d, s):
    st.info("Evidence types, strongest first: **tested** (you ran it), **provider-confirmed**, **documented** (official docs say so), "
            "**inferred** (likely, re-check before quoting), **unverified**. “Not found in the docs” never counts as “unsupported”.")
    caps = [c for c in d["requested"] + d["others"] if not c.get("synthetic")]
    for c in caps:
        with st.container(border=True):
            c1, c2 = st.columns([4, 2])
            c1.markdown(f"**{md(c['label'])}**")
            with c2:
                st.badge(STATUS_LABEL[c["status"]], color=STATUS_COLOR[c["status"]])
            for e in c.get("evidence", []):
                title = md(e["title"])
                st.markdown(f"- `{e['type']}` " + (f"[{title}]({e['url']})" if str(e.get("url", "")).startswith("http") else title))
            if not c.get("evidence"):
                st.caption("No evidence recorded yet.")

    with st.form("test", clear_on_submit=True):
        st.markdown("#### Record a test result")
        st.caption("Ran a safe test (for example in a sandbox)? Record what happened so the assessment rests on proof. Never paste tokens or secrets.")
        c1, c2 = st.columns(2)
        cap = c1.selectbox("Capability", [c["id"] for c in caps], format_func=lambda i: next(c["label"] for c in caps if c["id"] == i))
        result = c2.selectbox("Result", TEST_RESULTS)
        note = st.text_input("What did you observe?", placeholder="e.g. HTTP 200, message deleted")
        if st.form_submit_button("Add result"):
            state()["tests"].append({"capability": cap, "result": result, "note": note.strip()[:300],
                                     "date": datetime.date.today().isoformat()})
            save_state()
            st.rerun()

    if a.get("sources"):
        with st.expander(f"Web pages Gemini's search used ({len(a['sources'])})"):
            for src in a["sources"]:
                st.markdown(f"- [{md(src['title'])}]({src['url']})")
    if a.get("researchNotes"):
        with st.expander("Raw research notes"):
            st.markdown(md(a["researchNotes"]))


def tab_share(a, context, s, d):
    st.subheader("Share this guide")
    st.write("Send this link to your client, admin or teammate. It opens the same assessment with your answers, progress and test results.")
    base = (st.context.url or "").split("?")[0]
    params = {"app": a["id"], "name": a["provider"], "req": context["requirement"], "aud": context["audience"],
              "run": context["runtime"], "s": encode_state(s)}
    st.code(f"{base}?{urlencode(params)}", language=None, wrap_lines=True)
    st.caption("Use the copy button on the right. The link contains no credentials or tokens; this app never asks for them."
               + (" Live-research guides are kept while the app is running. If the app restarts, the viewer can re-run research." if a["tier"] == "live" else ""))
    st.subheader("Download a report")
    st.write("A Markdown document with the six report sections: summary, coverage, prerequisites, guide, production readiness and evidence.")
    st.download_button("Download report (.md)", to_markdown(a, context, s, d), file_name=f"{a['id']}-readiness-report.md", mime="text/markdown")


# ---------- apps without a researched guide ----------
def unresearched(a, context):
    with st.container(border=True):
        st.subheader(f"We haven't researched {a['provider']} yet")
        st.write("Rather than guess, the copilot only gives a feasibility verdict when it has evidence.")
        if a.get("docsUrl"):
            st.markdown(f"**Developer docs:** {a['docsUrl']}")
        if a.get("authHint"):
            st.markdown(f"**Typical authentication:** {a['authHint']} :gray-badge[unverified]")
        if gemini_key():
            if st.button("Run live research with Gemini", type="primary"):
                run_research(a, context)
            st.caption("Gemini searches the official docs. Takes about 30–90 seconds. Free keys have daily limits.")
        else:
            st.warning("Live research is off. Paste a free Gemini API key in the sidebar on the left (on a phone, tap » at the top left) to research any app.", icon="🔑")
    with st.container(border=True):
        st.markdown("**What the research answers, in this order**")
        st.markdown(
            "1. **Can it do what I need?** Each requested operation, with restrictions.\n"
            "2. **Can I access it?** Plans, billing, app creation, admin rights.\n"
            "3. **Can I launch it?** Reviews, verification, marketplace rules.\n"
            "4. **How do I build it?** Auth method, scopes, setup steps.\n"
            "5. **How do I prove it works?** Safe tests for each operation."
        )


def run_research(a, context):
    from copilot.research import ResearchError, run_live_research

    with st.status(f"Researching {a['provider']}…", expanded=True) as status:
        st.write("Searching official API references, access rules, approvals and auth setup…")
        try:
            result = run_live_research(
                a["provider"], gemini_key(), app_id=a["id"], category=a.get("category", ""),
                docs_url=a.get("docsUrl", ""), requirement=context["requirement"],
                audience=context["audience"], runtime=context["runtime"],
            )
        except ResearchError as err:
            status.update(label="Research didn't finish", state="error")
            st.error(str(err))
            return
        except Exception as err:  # unexpected: show it rather than a blank page
            status.update(label="Research didn't finish", state="error")
            st.error(f"Something went wrong: {err}")
            return
        st.write("Structuring the assessment…")
        research_store()[a["id"]] = result
        try:
            (DATA / "generated").mkdir(exist_ok=True)
            (DATA / "generated" / f"{a['id']}.json").write_text(json.dumps(result, indent=2))
        except OSError:
            pass  # read-only hosting: the in-memory copy still works
        status.update(label="Research complete", state="complete")
    reset_widgets()
    st.rerun()


# ---------- main ----------
st.session_state.key_from_config = bool(gemini_key()) and not st.session_state.get("user_key")
apps = all_apps()
sidebar(apps)
if qp.get("app") and re.fullmatch(r"[a-z0-9-]{1,80}", qp["app"]):
    assessment_page()
else:
    home(apps)
