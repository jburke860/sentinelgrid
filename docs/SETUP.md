# SentinelGrid — New Machine Setup

Everything you need is in git. A fresh `git clone` recovers the entire
project — code, tests, docs, CI workflows, the data snapshots, the favicon,
all of it. The only file that is *not* in the repo is `.env` (gitignored),
and it contains no real secrets: it is a straight copy of the tracked
`.env.example` with local dev defaults, recreated in one command below.

The things you reinstall rather than restore: `node_modules/`, Python
`.venv`s, Playwright browsers, and build outputs (`web/.next/`, `web/out/`,
`edge-sim/build/`). All of them regenerate from commands in this guide.

---

## 1. Clone

```sh
git clone https://github.com/jburke860/sentinelgrid.git
cd sentinelgrid
```

## 2. Dashboard only (what the Vercel demo runs)

This is the static, no-backend mode — usually all you need.

**Prerequisites:** Node.js 20+ (this machine runs v24). On a new Mac:
install [Homebrew](https://brew.sh), then `brew install node`.

```sh
cd web
npm install
npm run dev        # http://localhost:3000
```

Other web commands:

```sh
npm run build      # static export into web/out/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # 27 unit tests (vitest), incl. perf gates
```

### End-to-end tests (Playwright)

Playwright downloads its own browsers on first use:

```sh
cd web
npx playwright install chromium
npm run test:e2e   # 17 tests: 12 desktop + 5 mobile project
```

## 3. Full local stack (optional — live mode)

Only needed to run the real pipeline: edge-sim → MQTT → FastAPI →
Postgres/PostGIS → worker.

**Prerequisites:** Docker Desktop, Python 3.11+ (this machine runs 3.13),
CMake + a C++ compiler (`xcode-select --install` covers macOS).

```sh
# from the repo root
cp .env.example .env          # local dev defaults; nothing secret

# Python environments
cd api    && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..

make stack-up      # postgres + mosquitto + minio + api (:8000) + worker
make bridge-run    # builds edge-sim (CMake) and pipes it into the MQTT bridge

# dashboard against the live API:
cd web && NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

make stack-down    # stop everything
```

Backend tests: `make api-test` and `make worker-test`.

MQTT dev credentials are `sentinelgrid` / `sentinelgrid` (hashed copy
committed at `infra/mosquitto/passwd`; regenerate with
`make mosquitto-passwd`). These are local-only dev credentials, which is
why committing them is fine.

## 4. Deployment & CI — nothing to set up locally

- **Vercel** deploys `web/` automatically from GitHub pushes. Access lives
  in the Vercel account (log in on the web), not on any machine.
- **GitHub Actions** handle CI (typecheck, lint, unit + e2e, build) and the
  scheduled real-data refreshes (daily anchor + 4×/day verified stations).
  The refresh bot commits to `main` — so before pushing, always:

  ```sh
  git pull --rebase
  git push
  ```

  If the rebase conflicts on the data snapshot, keep the bot's version:

  ```sh
  git checkout --theirs web/src/data/live-snapshot.json
  git add web/src/data/live-snapshot.json
  git rebase --continue
  ```

## 5. Quick sanity checklist on a new machine

```sh
sh scripts/dev-check.sh        # repo skeleton intact
cd web && npm install && npm run typecheck && npm test && npm run build
ls out/favicon.ico             # static export produced the favicon
```

If those pass, the machine is fully set up for dashboard work — which is
where nearly all development on this project happens.
