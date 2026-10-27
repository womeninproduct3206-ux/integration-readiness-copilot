"""Run with:  python -m pytest -q   (needs: pip install pytest)"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from copilot import logic  # noqa: E402
from copilot.research import ResearchError, run_live_research  # noqa: E402
from google.genai import errors  # noqa: E402

APP = str(ROOT / "streamlit_app.py")


# ---------- product logic ----------
def test_library_has_100_plus_apps_and_4_guides():
    assert len(logic.load_directory()) >= 100
    assert logic.curated_ids() == {"slack", "google-drive", "shopify", "mongodb-atlas"}


@pytest.mark.parametrize("app_id", ["slack", "google-drive", "shopify", "mongodb-atlas"])
def test_curated_guides_are_complete(app_id):
    g = logic.load_curated(app_id)
    for key in ("capabilities", "blockers", "guide", "estimate", "auth", "clarifications"):
        assert g.get(key), f"{app_id} missing {key}"
    assert len(g["guide"]) == 6
    assert all(c["status"] in logic.STATUS_LABEL for c in g["capabilities"])


def test_slack_answer_changes_verdict_and_adds_admin_blocker():
    g = logic.load_curated("slack")
    ctx = {"requirement": g["defaultRequirement"], "audience": "external", "runtime": "both"}
    s = logic.empty_state()
    before = logic.derive(g, ctx, s)
    assert before["verdict"]["label"] == "Answer open questions before building"
    s["answers"]["delete-scope"] = 2
    after = logic.derive(g, ctx, s)
    assert after["verdict"]["label"] == "Feasible with conditions"
    assert "admin-token" in [b["id"] for b in after["blockers"]]


def test_uncovered_operation_is_shown_not_dropped():
    g = logic.load_curated("google-drive")
    d = logic.derive(g, {"requirement": "rename and search files"}, logic.empty_state())
    assert any(c["status"] for c in d["requested"])
    d = logic.derive(logic.load_curated("slack"), {"requirement": "search messages and remove messages"}, logic.empty_state())
    assert {c["op"] for c in d["requested"]} == {"read", "delete"}


def test_capability_gap_test_marks_unsupported():
    g = logic.load_curated("slack")
    s = logic.empty_state()
    s["tests"].append({"capability": "msg-create", "result": logic.TEST_RESULTS[2], "note": "", "date": "2026-01-01"})
    d = logic.derive(g, {"requirement": g["defaultRequirement"]}, s)
    assert d["verdict"]["cls"] == "blocked"


def test_state_round_trips_through_url():
    s = {**logic.empty_state(), "answers": {"q": 1}, "done": {"t": True}}
    assert logic.decode_state(logic.encode_state(s)) == s
    assert logic.decode_state("garbage!!") == logic.empty_state()


def test_markdown_report_has_six_sections():
    g = logic.load_curated("shopify")
    ctx = {"requirement": g["defaultRequirement"]}
    report = logic.to_markdown(g, ctx, logic.empty_state(), logic.derive(g, ctx, logic.empty_state()))
    assert all(f"## {i}." in report for i in range(1, 7))


# ---------- Gemini research with a fake client ----------
FAKE_ASSESSMENT = {
    "provider": "Acme", "product": "Acme API", "summary": "ok",
    "capabilities": [{"id": "c1", "resource": "Widgets", "op": "read", "label": "Read widgets", "method": "GET /widgets",
                      "status": "supported", "conditions": "", "evidence": [{"type": "documented", "title": "Docs", "url": "https://acme.test"}]}],
    "openQuestions": [], "auth": {"recommended": "OAuth", "why": "", "alternatives": []}, "blockers": [], "alternatives": [],
    "estimate": {"engineering": {"range": "1 day", "assumptions": ""}, "waiting": {"range": "0", "notes": ""}, "uncertainty": []},
    "guide": [],
}


class FakeModels:
    def __init__(self, fail_grounding=None):
        self.calls = []
        self.fail_grounding = fail_grounding

    def generate_content(self, model, contents, config):
        self.calls.append((model, config))
        if config.tools and self.fail_grounding:
            raise errors.ClientError(self.fail_grounding, {"error": {"message": "nope"}})
        if config.response_mime_type == "application/json":
            return SimpleNamespace(text=json.dumps(FAKE_ASSESSMENT), candidates=[])
        chunk = SimpleNamespace(web=SimpleNamespace(uri="https://acme.test/docs", title="acme.test", domain="acme.test"))
        return SimpleNamespace(text="Acme supports reading widgets. https://acme.test/docs",
                               candidates=[SimpleNamespace(grounding_metadata=SimpleNamespace(grounding_chunks=[chunk]))])


def test_grounded_research_keeps_sources():
    models = FakeModels()
    result = run_live_research("Acme", "k", app_id="acme", client=SimpleNamespace(models=models))
    assert result["grounded"] and result["tier"] == "live"
    assert result["sources"][0]["url"] == "https://acme.test/docs"
    assert models.calls[0][1].tools and models.calls[1][1].response_json_schema
    assert result["capabilities"][0]["evidence"][0]["type"] == "documented"


def test_falls_back_without_search_and_downgrades_evidence():
    models = FakeModels(fail_grounding=400)
    result = run_live_research("Acme", "k", app_id="acme", client=SimpleNamespace(models=models))
    assert result["grounded"] is False
    assert result["capabilities"][0]["evidence"][0]["type"] == "inferred"
    assert "Not checked against live documentation" in result["summary"]


def test_quota_error_is_explained():
    class Quota:
        def generate_content(self, **_):
            raise errors.ClientError(429, {"error": {"message": "quota"}})
    with pytest.raises(ResearchError, match="free Gemini quota"):
        run_live_research("Acme", "k", app_id="acme", client=SimpleNamespace(models=Quota()))


# ---------- the Streamlit UI ----------
def test_home_renders():
    at = AppTest.from_file(APP, default_timeout=30).run()
    assert not at.exception
    assert at.title[0].value == "What are you trying to integrate?"


def test_slack_flow_end_to_end():
    at = AppTest.from_file(APP, default_timeout=30)
    at.query_params.update({"app": "slack", "name": "Slack", "aud": "external", "run": "both"})
    at.run()
    assert not at.exception
    assert "Answer open questions" in at.info[0].value
    next(b for b in at.button if b.label == "Any message in the workspace").click().run()
    assert "Feasible with conditions" in at.warning[0].value
    assert at.query_params["s"]  # progress is in the URL, so the address bar is shareable
    at.checkbox(key="next-task-s-p1").check().run()
    assert not at.exception
    assert logic.decode_state(at.query_params["s"][0] if isinstance(at.query_params["s"], list) else at.query_params["s"])["done"]["s-p1"]


@pytest.mark.parametrize("app_id", ["google-drive", "shopify", "mongodb-atlas", "notion", "made-up-app"])
def test_other_pages_render(app_id):
    at = AppTest.from_file(APP, default_timeout=30)
    at.query_params.update({"app": app_id, "name": app_id})
    at.run()
    assert not at.exception
