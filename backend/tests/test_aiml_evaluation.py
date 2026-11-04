"""Regression tests for the ported 40-case ticket-intelligence benchmark."""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aiml.evaluate import (  # noqa: E402
    load_dataset,
    render_markdown,
    evaluate,
    write_reports,
)


def test_benchmark_matches_ported_baseline() -> None:
    dataset = load_dataset()
    summary = evaluate(dataset, provider="deterministic")

    assert summary["provider"] == "deterministic-demo"
    assert summary["model"] == "miraiwerk-rules-v1"
    assert summary["totals"]["cases"] == 40
    assert summary["totals"]["passed"] == 36
    assert summary["metrics"]["ticketTypeAccuracy"] == 1.0
    assert summary["metrics"]["priorityAccuracy"] == 0.975
    assert summary["metrics"]["recommendationAccuracy"] == 1.0
    assert summary["metrics"]["evidenceDiscipline"] == 1.0
    assert summary["metrics"]["proposalCompleteness"] == 1.0
    assert summary["metrics"]["duplicate"]["accuracy"] == 0.925
    assert summary["metrics"]["overall"] == 0.995

    mismatched = sorted(case["id"] for case in summary["cases"] if not case["pass"])
    assert mismatched == ["BUG-02", "BUG-09", "BUG-10", "FEAT-02"]


def test_every_case_has_unique_id_and_expected_labels() -> None:
    dataset = load_dataset()
    case_ids = [case["id"] for case in dataset["cases"]]
    assert len(case_ids) == 40
    assert len(set(case_ids)) == 40

    for case in dataset["cases"]:
        expected = case["expected"]
        assert expected["ticketType"] in {
            "incident",
            "bug",
            "feature_request",
            "technical_debt",
            "clarification",
        }
        assert expected["priority"] in {"P0", "P1", "P2", "P3"}
        assert expected["recommendation"] in {
            "accept",
            "split",
            "defer",
            "duplicate",
            "clarify",
        }
        assert isinstance(expected["minUnknowns"], int)
        assert case["note"]


def test_generated_reports_label_deterministic_provenance(tmp_path) -> None:
    summary = evaluate(load_dataset(), provider="deterministic")
    report_path, json_path = write_reports(
        summary,
        report_path=tmp_path / "report.md",
        json_path=tmp_path / "report.json",
    )

    report = report_path.read_text(encoding="utf-8")
    payload = json.loads(json_path.read_text(encoding="utf-8"))

    assert payload["provider"] == "deterministic-demo"
    assert payload["model"] == "miraiwerk-rules-v1"
    assert "labelled rules, not a model output" in report
    assert "No network model was called" in report
    assert "40 hand-labelled cases" in report
    assert "does not measure whether a model is better" in report


def test_gemini_mode_requires_a_configured_key(monkeypatch) -> None:
    for name in ("GEMINI_API_KEY", "GOOGLE_AI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    try:
        evaluate(load_dataset(), provider="gemini")
    except RuntimeError as error:
        assert "GEMINI_API_KEY" in str(error)
    else:  # pragma: no cover - protects the offline benchmark contract
        raise AssertionError("Gemini mode ran without a configured key.")


def test_markdown_render_is_deterministic_for_the_same_summary() -> None:
    summary = evaluate(load_dataset(), provider="deterministic")
    assert render_markdown(summary) == render_markdown(summary)
