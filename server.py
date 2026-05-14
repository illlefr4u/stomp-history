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
        if parsed.path == "/api/replay":
            self.handle_replay(parsed.query)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    # cache: battleKey -> replay result (deterministic per key once teams known)
    _replay_cache: dict[str, dict] = {}

    def handle_replay(self, query: str) -> None:
        params = parse_qs(query)
        address = (params.get("address") or [""])[0]
        battle_key = (params.get("battle") or [""])[0]
        if not address or not battle_key:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "address and battle required"})
            return
        cached = Handler._replay_cache.get(battle_key.lower())
        if cached is not None:
            self.send_json(HTTPStatus.OK, {"ok": True, "fromCache": True, **cached})
            return
        try:
            history = stomp_history.fetch_history(address, limit=200, include_events=False, enrich=True)
            battle = next((b for b in history["battles"] if b["battleKey"].lower() == battle_key.lower()), None)
            if battle is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "battle not found for that address"})
                return
            inputs = stomp_history.prepare_replay_inputs(battle)
            result = stomp_history.run_replay_subprocess(inputs)
            result["battleKey"] = battle_key
            Handler._replay_cache[battle_key.lower()] = result
            self.send_json(HTTPStatus.OK, {"ok": True, "fromCache": False, **result})
        except stomp_history.HistoryError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})

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
