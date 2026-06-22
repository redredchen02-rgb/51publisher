import csv
import json

import scraper.exporters as exporters


def test_export_csv_header_is_sorted_union_of_keys(tmp_path):
    data = [{"b": 2, "a": 1}, {"a": 3, "c": 4}]
    out = tmp_path / "comics.csv"
    exporters.export_csv(data, str(out))
    with open(out, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert rows[0].keys() == {"a", "b", "c"}          # union across rows
    assert list(rows[0].keys()) == ["a", "b", "c"]    # sorted order
    assert rows[1]["c"] == "4"
    assert rows[1]["b"] == ""                           # missing key -> blank


def test_export_csv_empty_creates_no_file(tmp_path):
    out = tmp_path / "empty.csv"
    exporters.export_csv([], str(out))
    assert not out.exists()


def test_export_json_roundtrips_unicode(tmp_path):
    data = [{"title": "测试", "n": 1}]
    out = tmp_path / "comics.json"
    exporters.export_json(data, str(out))
    with open(out, encoding="utf-8") as f:
        loaded = json.load(f)
    assert loaded == data
    # ensure_ascii=False keeps CJK literal, not escaped.
    assert "测试" in out.read_text(encoding="utf-8")
