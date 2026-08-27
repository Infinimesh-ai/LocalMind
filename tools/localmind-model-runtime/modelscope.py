#!/usr/bin/env python3
"""Resolve or download one ModelScope snapshot and emit one JSON result."""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
from pathlib import Path


def bounded_message(error: BaseException) -> str:
    message = str(error).replace("\n", " ").strip()
    message = re.sub(r"([?&](?:token|access_token|api_key)=)[^&\s]+", r"\1<redacted>", message, flags=re.I)
    message = re.sub(r"(Bearer\s+)[A-Za-z0-9._~-]+", r"\1<redacted>", message, flags=re.I)
    return message[:1000]


def is_cache_miss(error: BaseException) -> bool:
    if isinstance(error, FileNotFoundError):
        return True

    message = str(error).lower()
    cache_markers = (
        "local_files_only",
        "cached path",
        "cached snapshot folder",
        "appropriate cached snapshot",
    )
    missing_markers = (
        "not found",
        "cannot find",
        "does not exist",
        "no such file",
        "missing",
    )
    return any(marker in message for marker in cache_markers) and any(
        marker in message for marker in missing_markers
    )


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--cache-dir")
    parser.add_argument("--local-dir")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()

    # This helper is named modelscope.py, so exclude its own directory before
    # importing the external package with the same name.
    helper_dir = Path(__file__).resolve().parent
    sys.path = [
        entry
        for entry in sys.path
        if Path(entry or ".").resolve() != helper_dir
    ]

    try:
        from modelscope import snapshot_download
    except Exception as error:  # pragma: no cover - depends on the host runtime
        emit(
            {
                "status": "error",
                "kind": "dependency_missing",
                "errorType": type(error).__name__,
                "message": bounded_message(error),
            }
        )
        return 3

    kwargs: dict[str, object] = {
        "revision": args.revision,
        "local_files_only": not args.download,
    }
    if args.cache_dir:
        kwargs["cache_dir"] = str(Path(args.cache_dir).expanduser().resolve())
    if args.local_dir:
        kwargs["local_dir"] = str(Path(args.local_dir).expanduser().resolve())

    try:
        # Keep stdout machine-readable even when an SDK version prints progress.
        with contextlib.redirect_stdout(sys.stderr):
            snapshot = snapshot_download(args.model, **kwargs)
        snapshot_path = Path(snapshot).expanduser().resolve()
    except Exception as error:  # ModelScope exposes several backend-specific errors.
        if not args.download and is_cache_miss(error):
            emit(
                {
                    "status": "missing",
                    "model": args.model,
                    "revision": args.revision,
                }
            )
            return 0

        emit(
            {
                "status": "error",
                "kind": "download_failed" if args.download else "cache_probe_failed",
                "errorType": type(error).__name__,
                "message": bounded_message(error),
            }
        )
        return 4

    emit(
        {
            "status": "downloaded" if args.download else "found",
            "model": args.model,
            "revision": args.revision,
            "path": str(snapshot_path),
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
