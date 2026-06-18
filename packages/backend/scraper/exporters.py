import csv
import json
import logging
import os

logger = logging.getLogger("scraper")


def export_json(data, filepath: str):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if isinstance(data, list):
        logger.info(f"[Export] JSON -> {filepath} ({len(data)} records)")
    elif isinstance(data, dict):
        total = sum(len(v) for v in data.values() if isinstance(v, list))
        logger.info(f"[Export] JSON -> {filepath} ({total} records)")


def export_csv(data: list[dict], filepath: str):
    if not data:
        logger.info("[Export] No data to export")
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
    logger.info(f"[Export] CSV -> {filepath} ({len(data)} records)")
