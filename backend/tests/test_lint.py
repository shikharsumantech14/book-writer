from __future__ import annotations

from fakes import make_draft

from bookwriter.checks.lint import lint, split_sentences, word_count
from bookwriter.models import ChapterDraft

IDS = {"E1", "E2", "E3", "E4", "E5", "E6"}


def rules(draft, cfg, ids=IDS):
    return {i.rule for i in lint(draft, ids, cfg.brief)}


def with_paragraph(draft: ChapterDraft, i: int, text: str) -> ChapterDraft:
    paras = list(draft.paragraphs)
    paras[i] = text
    return draft.model_copy(update={"paragraphs": paras})


def test_clean_draft_passes(cfg):
    draft = make_draft(1, sorted(IDS))
    assert 600 <= word_count(draft) <= 900
    assert lint(draft, IDS, cfg.brief) == []


def test_length_and_structure(cfg):
    assert {"length", "structure"} <= rules(make_draft(1, sorted(IDS), paragraphs=3), cfg)
    assert "length" in rules(make_draft(1, sorted(IDS), paragraphs=12), cfg)


def test_word_count_ignores_citation_markers():
    d = ChapterDraft(title="t", paragraphs=["One two three [E1][E2]."], takeaway="Takeaway: four five.")
    assert word_count(d) == 6


def test_format_rules(cfg):
    base = make_draft(1, sorted(IDS))
    assert "no_lists" in rules(with_paragraph(base, 1, "- first item\n- second item [E1]."), cfg)
    assert "no_headings" in rules(with_paragraph(base, 1, "## A heading and **bold** text [E1]."), cfg)
    assert "no_urls" in rules(with_paragraph(base, 1, "See https://www.npci.org.in for more [E1]."), cfg)
    assert "takeaway" in rules(with_paragraph(base, 1, "Takeaway: this belongs at the end."), cfg)


def test_citation_rules(cfg):
    base = make_draft(1, sorted(IDS))
    assert "citation_format" in rules(with_paragraph(base, 1, "UPI grew fast [E1, E2]."), cfg)
    assert "citation_placement" in rules(with_paragraph(base, 1, "UPI grew fast. [E1]"), cfg)
    assert "unknown_citation" in rules(with_paragraph(base, 1, "UPI grew fast [E99]."), cfg)
    assert "too_few_citations" in rules(make_draft(1, ["E1", "E2"]), cfg)


def test_figures_need_citations(cfg):
    base = make_draft(1, sorted(IDS))
    assert "uncited_figure" in rules(with_paragraph(base, 1, "UPI launched in 2016 and grew fast."), cfg)
    assert "uncited_figure" not in rules(with_paragraph(base, 1, "UPI launched in 2016 and grew fast [E1]."), cfg)


def test_takeaway_rules(cfg):
    base = make_draft(1, sorted(IDS))
    for bad in ("Start small.", "Takeaway: UPI handled 20 billion payments.", "Takeaway: cite this [E1]."):
        assert "takeaway" in rules(base.model_copy(update={"takeaway": bad}), cfg), bad


def test_split_sentences_keeps_paragraph_index():
    out = split_sentences(["First one [E1]. Second one.", "Third one."])
    assert [(sid, pi) for sid, pi, _ in out] == [(0, 0), (1, 0), (2, 1)]
    assert out[0][2] == "First one [E1]."


def test_names_and_codes_with_digits_are_not_figures(cfg):
    base = make_draft(1, sorted(IDS))
    for text in ("Feature phones can use UPI123Pay.", "Dial *99# on any phone.", "A 4G phone works too."):
        assert "uncited_figure" not in rules(with_paragraph(base, 1, text), cfg), text
    for text in ("UPI launched in 2016.", "Tea costs ₹50.", "Its share was 84%.", "It grew 1.78 crore."):
        assert "uncited_figure" in rules(with_paragraph(base, 1, text), cfg), text


def test_figures_are_compared_without_separators():
    from bookwriter.checks.lint import figures

    assert figures("24,162 crore in FY2025-26 [E4]") == {"24162", "26"}
    claim, quote = "Launched on 25 August 2016.", "NPCI launched UPI on August 25, 2016."
    assert figures(claim) <= figures(quote)


def test_sentence_split_ignores_abbreviations_and_initials():
    from bookwriter.checks.lint import sentences

    text = (
        "The pilot launch was done on 11th April 2016 by Dr. Raghuram Rajan [E1]. "
        "Raghuram G. Rajan was the RBI Governor. Tea costs Rs. 50 here [E2]. "
        "Apps, e.g. BHIM, work too. It grew fast."
    )
    assert sentences(text) == [
        "The pilot launch was done on 11th April 2016 by Dr. Raghuram Rajan [E1].",
        "Raghuram G. Rajan was the RBI Governor.",
        "Tea costs Rs. 50 here [E2].",
        "Apps, e.g. BHIM, work too.",
        "It grew fast.",
    ]


def test_cited_sentence_with_a_title_is_not_flagged(cfg):
    base = make_draft(1, sorted(IDS))
    text = "UPI's pilot was launched on 11th April 2016 by Dr. Raghuram Rajan in Mumbai [E1]."
    assert "uncited_figure" not in rules(with_paragraph(base, 1, text), cfg)
