#!/usr/bin/env python3
"""Post a GitHub release summary to a Discord webhook (#공지)."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DISCORD_DESC_LIMIT = 3800
REPO = os.environ.get("GITHUB_REPOSITORY", "AutumnColor77/Live-MR-Manager")


def extract_release_notes(tag: str, notes_path: Path) -> str:
    if not notes_path.is_file():
        return f"{tag} 릴리즈가 GitHub에 게시되었습니다."

    text = notes_path.read_text(encoding="utf-8")
    pattern = rf"## {re.escape(tag)} \([^)]+\)\r?\n(.*?)(?=\r?\n---|\r?\n## v|\Z)"
    match = re.search(pattern, text, re.DOTALL)
    if not match:
        return f"{tag} 릴리즈가 GitHub에 게시되었습니다.\n\n상세: RELEASE_NOTES.md"

    body = match.group(1).strip()
    if len(body) > DISCORD_DESC_LIMIT:
        body = body[: DISCORD_DESC_LIMIT - 1].rstrip() + "\n\n…"
    return body


def build_payload(tag: str, description: str) -> dict:
    release_url = f"https://github.com/{REPO}/releases/tag/{tag}"
    download_url = f"{release_url}#:~:text=Assets"
    return {
        "username": "Live MR Manager",
        "allowed_mentions": {"parse": []},
        "embeds": [
            {
                "title": f"🎙️ Live MR Manager {tag} 릴리즈",
                "url": release_url,
                "description": description,
                "color": 0xF59E0B,
                "fields": [
                    {
                        "name": "다운로드",
                        "value": f"[GitHub Releases]({release_url})",
                        "inline": True,
                    },
                    {
                        "name": "FAQ",
                        "value": "[lmrm.vercel.app/faq](https://lmrm.vercel.app/faq)",
                        "inline": True,
                    },
                ],
                "footer": {"text": "Windows NSIS 설치 파일 · 베타"},
            }
        ],
    }


def post_webhook(url: str, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "Live-MR-Manager-release-bot",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"Discord webhook HTTP {resp.status}")


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: discord_release_announce.py <tag> [RELEASE_NOTES.md]", file=sys.stderr)
        return 2

    tag = sys.argv[1].strip()
    if not tag.startswith("v"):
        tag = f"v{tag}"

    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not webhook:
        print("DISCORD_WEBHOOK_URL not set - skipping Discord announce.")
        return 0

    notes_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("RELEASE_NOTES.md")
    description = extract_release_notes(tag, notes_path)
    payload = build_payload(tag, description)

    try:
        post_webhook(webhook, payload)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        print(f"Discord webhook failed: HTTP {err.code}\n{body}", file=sys.stderr)
        return 1
    except OSError as err:
        print(f"Discord webhook failed: {err}", file=sys.stderr)
        return 1

    print(f"Posted {tag} release announce to Discord.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
