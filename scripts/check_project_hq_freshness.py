#!/usr/bin/env python3
"""Check whether project-report metadata lags meaningful repository commits.

This detects potentially stale reporting; it never updates project status itself.
Uses Python stdlib only and does not inspect or publish private budget data.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False)


def main() -> int:
    status_file = Path(".project/STATUS.yaml")
    if not status_file.exists():
        print("::error::Missing .project/STATUS.yaml")
        return 1

    status = status_file.read_text(encoding="utf-8")
    block = re.search(r"(?ms)^source:\s*\n((?:[ \t]+[^\n]*\n)+)", status)
    sha = re.search(r'(?m)^  commit: "([a-fA-F0-9]{40})"\s*$', block.group(1)) if block else None
    if not sha:
        print("::error::Missing or invalid STATUS.yaml source.commit (40-character SHA)")
        return 1

    baseline = sha.group(1)
    ancestor = git("merge-base", "--is-ancestor", baseline, "HEAD")
    if ancestor.returncode:
        print(f"::error::Report source.commit {baseline} is not an ancestor of HEAD")
        return 1

    log = git("log", "--pretty=format:", "--name-only", f"{baseline}..HEAD")
    if log.returncode:
        print(f"::error::Unable to inspect repository changes: {log.stderr.strip()}")
        return 1

    ignored_prefixes = (".project/", ".github/", ".vscode/", ".codex/")
    ignored_names = {
        "AGENTS.md", "docs/AGENTS.md", "docs/agent-operations.md",
        "docs/agent-project-rules.md", "docs/checks.md", ".gitignore",
        "scripts/check_project_hq_freshness.py",
    }
    changed = sorted({
        p.strip() for p in log.stdout.splitlines()
        if p.strip() and not p.startswith(ignored_prefixes) and p.strip() not in ignored_names
    })
    if not changed:
        message = f"Project HQ report covers all substantive changes through {baseline[:10]}."
        print(message)
    else:
        files = ", ".join(changed[:12]) + (" ..." if len(changed) > 12 else "")
        message = (
            f"Project HQ report may be stale: repository changed after "
            f"STATUS.yaml source.commit {baseline[:10]}. Changed files: {files}. "
            "Review the changes, then refresh the .project files and advance "
            "source.commit to the inspected pushed revision."
        )
        print(f"::error::{message}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as file:
            file.write(("\u26a0\ufe0f " if changed else "\u2705 ") + message + "\n")

    return 1 if changed else 0


if __name__ == "__main__":
    sys.exit(main())
