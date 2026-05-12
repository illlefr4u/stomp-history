#!/usr/bin/env python3
"""Local web server for the Stomp History viewer."""
from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import stomp_history


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if parsed.path == "/api/history":
            self.handle_history(parsed.query)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def handle_history(self, query: str) -> None:
        params = parse_qs(query)
        address = (params.get("address") or [""])[0]
        try:
            limit = int((params.get("limit") or ["30"])[0])
            max_pages_raw = (params.get("maxPages") or [""])[0]
            max_pages = int(max_pages_raw) if max_pages_raw else None
            from_block_raw = (params.get("fromBlock") or [""])[0]
            from_block = int(from_block_raw) if from_block_raw else None
            scan_starts = (params.get("scanStarts") or ["false"])[0].lower() in {"1", "true", "yes"}
            enrich = (params.get("enrich") or ["true"])[0].lower() not in {"0", "false", "no"}
            payload = stomp_history.fetch_history(
                address,
                limit=limit,
                max_pages=max_pages,
                scan_starts=scan_starts,
                from_block=from_block,
                include_events=False,
                enrich=enrich,
            )
        except Exception as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return
        self.send_json(HTTPStatus.OK, {"ok": True, **payload})


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Stomp History web viewer")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Stomp History viewer: http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
