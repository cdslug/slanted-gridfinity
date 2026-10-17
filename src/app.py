"""Serve the Slanted Gridfinity app locally and open it in a browser.

Usage:
    python src/app.py              # serves on port 8000 (or the next free one)
    python src/app.py --port 9000
    python src/app.py --no-browser
    python src/app.py --host 0.0.0.0   # reachable from your network (see warning)

Only the web app itself is served (index.html, css/, js/, vendor/, fonts/).
The .git folder, src/ and anything else in the repo stay private.
"""

import argparse
import functools
import http.server
import ipaddress
import os
import socket
import threading
import webbrowser
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent

# The only paths a browser may request, relative to ROOT.
PUBLIC_FILES = {"index.html"}
PUBLIC_DIRS = {"css", "js", "vendor", "fonts"}


def is_loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def is_allowed_host_header(value, port):
    """Accept Host headers a DNS-rebinding page can't produce.

    A rebinding attack needs a domain name the attacker controls, so only IP
    literals, localhost and mDNS (.local) names are accepted, on our port.
    """
    parsed = urlsplit(f"//{value}")
    hostname = parsed.hostname
    try:
        host_port = parsed.port
    except ValueError:
        return False
    if not hostname or host_port != port:
        return False
    if hostname == "localhost" or hostname.endswith(".local"):
        return True
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        return False


def is_public_path(url_path):
    parts = [p for p in unquote(urlsplit(url_path).path).split("/") if p]
    if not parts:
        return True  # "/" serves index.html
    if any(p.startswith(".") or "\\" in p for p in parts):
        return False
    if parts == ["index.html"]:
        return True
    return parts[0] in PUBLIC_DIRS and len(parts) > 1


class Handler(http.server.SimpleHTTPRequestHandler):
    # Some Python installs map .js to text/plain, which breaks ES modules.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
    }

    def send_head(self):
        # Used by both GET and HEAD, so every file request passes through here.
        if not is_allowed_host_header(self.headers.get("Host", ""), self.server.server_port):
            self.send_error(HTTPStatus.FORBIDDEN, "Unexpected Host header")
            return None
        if not is_public_path(self.path) or not self._resolves_inside_root():
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        return super().send_head()

    def _resolves_inside_root(self):
        # Refuse anything a symlink would lead outside the repo.
        real = os.path.realpath(self.translate_path(self.path))
        return real == str(ROOT) or real.startswith(str(ROOT) + os.sep)

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def end_headers(self):
        # Always serve fresh files so edits show up on reload.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format, *args):
        # Quiet on loopback; on the network, show who is connecting.
        if self.server.log_requests:
            super().log_message(format, *args)


def find_free_port(host, start):
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((host, port)) != 0:
                return port
    raise RuntimeError(f"No free port found between {start} and {start + 49}")


def main():
    parser = argparse.ArgumentParser(description="Run the Slanted Gridfinity app.")
    parser.add_argument("--host", default="127.0.0.1",
                        help="address to listen on; anything but loopback exposes the app to your network")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    local = is_loopback(args.host)
    port = find_free_port(args.host, args.port)
    handler = functools.partial(Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer((args.host, port), handler)
    server.log_requests = not local

    # A wildcard bind is reachable locally on loopback; open the tab there.
    browse_host = "127.0.0.1" if args.host in ("0.0.0.0", "") else args.host
    url = f"http://{browse_host}:{port}/"

    print(f"Slanted Gridfinity running at {url}  (Ctrl+C to stop)", flush=True)
    if not local:
        print(
            f"WARNING: listening on {args.host or 'all interfaces'}, so anyone on your network "
            "can load this app.\n"
            "         Use it only on networks you trust. Requests are logged below.",
            flush=True,
        )
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
