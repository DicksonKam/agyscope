#!/usr/bin/env python3
"""
AGYScope statusLine tap for the official Antigravity CLI (`agy`).
Reads the documented JSON statusLine payload on stdin, saves only allowlisted quota/metadata
fields to AGYScope's local tap folder, and forwards stdin verbatim to any chained user command.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

APP_SUPPORT = os.environ.get(
    "AGYSCOPE_APP_SUPPORT",
    os.path.join(os.path.expanduser("~"), "Library", "Application Support", "AGYScope"),
)
TAP_DIR = os.path.join(APP_SUPPORT, "tap")
LOG_PATH = os.path.join(TAP_DIR, "statusline.jsonl")
LATEST_PATH = os.path.join(TAP_DIR, "latest.json")
CHAIN_PATH = os.path.join(TAP_DIR, "chain.json")


def extract_allowlisted(payload: dict) -> dict | None:
    quota = payload.get("quota")
    if not isinstance(quota, dict) or not quota:
        return None
    clean_quota = {}
    for key, entry in quota.items():
        if not isinstance(key, str) or not isinstance(entry, dict):
            continue
        item = {}
        for field in ("remaining_fraction", "used_percentage", "remaining_percentage", "reset_in_seconds"):
            val = entry.get(field)
            if isinstance(val, (int, float)):
                item[field] = val
        reset_time = entry.get("reset_time")
        if isinstance(reset_time, str):
            item["reset_time"] = reset_time[:64]
        if item:
            clean_quota[key[:64]] = item
    if not clean_quota:
        return None

    record = {
        "v": 1,
        "at": int(time.time() * 1000),
        "quota": clean_quota,
    }
    for src, dst in (
        ("version", "version"),
        ("plan_tier", "plan_tier"),
        ("session_id", "session_id"),
    ):
        val = payload.get(src)
        if isinstance(val, str) and val.strip():
            record[dst] = val[:128]
    if isinstance(payload.get("credits_active"), bool):
        record["credits_active"] = payload["credits_active"]
    return record


def write_record(record: dict) -> None:
    os.makedirs(TAP_DIR, mode=0o700, exist_ok=True)
    line = json.dumps(record, separators=(",", ":"))
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    fd, tmp_path = tempfile.mkstemp(prefix=".latest-", dir=TAP_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(line)
        os.replace(tmp_path, LATEST_PATH)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def run_chained(raw: bytes) -> None:
    if not os.path.exists(CHAIN_PATH):
        return
    try:
        with open(CHAIN_PATH, "r", encoding="utf-8") as fh:
            chain = json.load(fh)
        cmd = chain.get("command")
        if not isinstance(cmd, str) or not cmd.strip():
            return
        proc = subprocess.run(cmd, shell=True, input=raw, check=False)
        sys.exit(proc.returncode)
    except Exception:
        return


def main() -> None:
    raw = sys.stdin.buffer.read()
    try:
        payload = json.loads(raw.decode("utf-8"))
        if isinstance(payload, dict):
            record = extract_allowlisted(payload)
            if record:
                write_record(record)
    except Exception:
        pass
    run_chained(raw)


if __name__ == "__main__":
    main()
