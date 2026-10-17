# Agent rules for this repo

Slanted Gridfinity is a public repo: a static web app (`index.html`, `css/`,
`js/`, `vendor/`, `fonts/`) plus a stdlib-only Python launcher (`src/app.py`).
Everything you commit or push is public. These rules are mandatory; if a task
seems to require breaking one, stop and ask the user first.

## 1. Git, identity and privacy

- Commit only as `cdslug <cdslug@gmail.com>`. Check `git config user.email`
  before committing; if it shows anything else, stop and ask.
- Never write work emails, employer names, or names of other private projects
  into files, comments, or commit messages. Don't add new references to
  `form-fit-print` or `LinearVolumeSweep`. Naming the public product, Form
  Fit Print or formfitprint.com, is fine; pointing at its source tree is not.
- Never commit secrets, tokens, `.env` files, or generated `*.stl` files.
- Never rewrite history, force-push, delete branches, or push at all without
  the user's explicit approval for that specific action.

## 2. The local server (`src/app.py`)

The launcher is the main attack surface: it once served `.git/` to anyone who
could reach the port. Keep every one of these protections:

- **Allowlist only.** Serve nothing outside `PUBLIC_FILES` / `PUBLIC_DIRS`. A
  new top-level web folder must be added there deliberately. Never serve the
  repo root wholesale, `.git/`, `src/`, or dotfiles.
- **No directory listings.** `list_directory` returns 404.
- **Host header check.** Accept only IP literals, `localhost`, or `*.local` on
  the server's own port; this blocks DNS rebinding. Don't loosen it.
- **Loopback by default.** `--host` stays `127.0.0.1`. When it is anything else,
  the warning and request logging stay on.
- Keep the `nosniff` header, and stay stdlib-only on Python 3.11+.
- In docs, never suggest a server that listens on all interfaces from the repo
  root. Use `python3 -m http.server --bind 127.0.0.1`, not bare
  `python3 -m http.server` (it serves `.git/` to your whole network).

## 3. The page

- **Content-Security-Policy** (`<meta>` in `index.html`) allows only same-origin
  files plus two inline scripts by SHA-256 hash: the theme bootstrap and the
  import map. If you change either script's text, even whitespace, recompute
  its hash and update the policy, or the page will not load:
  ```bash
  python3 - <<'EOF'
  import re, hashlib, base64
  s = open('index.html').read()
  for m in re.finditer(r'<script(?: type="importmap")?>(.*?)</script>', s, re.S):
      print("'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode() + "'")
  EOF
  ```
  Never add `'unsafe-inline'`, `'unsafe-eval'`, inline event handlers
  (`onclick=`), new inline scripts, or outside origins.
- **No network requests.** No CDNs, analytics, fonts from other sites, or
  `fetch` to outside hosts. Everything is vendored.
- **No HTML injection.** Build DOM with `createElement` and `textContent`. Don't
  use `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or
  `new Function`.
- **Clamp every number.** Browsers don't enforce `min`/`max` on typed values,
  and an unbounded size can hang the tab. Read inputs with `readNumber()` /
  `readUnits()` in `js/main.js`, which clamp to the input's own `min`/`max`,
  and give every new numeric input explicit `min`/`max`.
- **Treat outside input as untrusted.** If you add shareable URLs, query or hash
  parameters, file import, or `localStorage` reads, validate against an
  allowlist or clamp before use. (The saved theme only accepts `'dark'` or
  `'light'`.)
- External links use `target="_blank" rel="noopener"`.

## 4. Vendored code

- Get three.js only from the official npm package, never from a CDN or a copy
  of unknown origin. Current files, `three@0.162.0`:

  | File | SHA-256 |
  |---|---|
  | `vendor/three/three.module.min.js` | `ecd9f6b9bc1a12efdf14d13e4c610c012903c141a77d967d3f500bc727f0896c` |
  | `vendor/three/addons/controls/OrbitControls.js` | `f260591ef315aa04888152e7f121865214e33fb54727145cf4e4445058db1297` |

- When you upgrade, download the tarball from `registry.npmjs.org` into a
  scratch directory, copy the files over, confirm their hashes match the
  tarball, and update this table in the same commit.
- Don't edit vendored files by hand.

## 5. Check before you finish

Run these when you touch `src/app.py`, `index.html`, or the input handling:

```bash
python3 src/app.py --no-browser --port 8765 &
B=http://127.0.0.1:8765
for p in / /js/main.js /.git/config /.git/ /src/app.py /README.md /js/ /%2egit/config /js/../.git/config; do
  printf '%-24s %s\n' "$p" "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "$B$p")"
done   # expect 200 for the first two, 404 for the rest
curl -s -o /dev/null -w 'bad Host: %{http_code}\n' -H 'Host: attacker.example:8765' $B/   # expect 403
pkill -f 'src/app.py --no-browser --port 8765'
```

If you changed the page, load it in a browser (or headless Chrome) and check
there are no CSP violations or console errors, and that the Dimensions panel
fills in.
