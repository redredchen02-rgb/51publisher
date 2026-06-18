import csv
import json
import os


def export_json(data, filepath: str):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if isinstance(data, list):
        print(f"  [Export] JSON -> {filepath} ({len(data)} records)")
    elif isinstance(data, dict):
        total = sum(len(v) for v in data.values() if isinstance(v, list))
        print(f"  [Export] JSON -> {filepath} ({total} records)")


def export_csv(data: list[dict], filepath: str):
    if not data:
        print("  [Export] No data to export")
        return
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    all_keys = set()
    for row in data:
        all_keys.update(row.keys())
    fieldnames = sorted(all_keys)
    with open(filepath, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(data)
    print(f"  [Export] CSV -> {filepath} ({len(data)} records)")
