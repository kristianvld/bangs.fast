# bangs.fast

[![Browser E2E Tests](https://github.com/kristianvld/bangs.fast/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/kristianvld/bangs.fast/actions/workflows/e2e.yml)
[![Publish to GitHub Pages](https://github.com/kristianvld/bangs.fast/actions/workflows/pages-deploy.yml/badge.svg?branch=main)](https://github.com/kristianvld/bangs.fast/actions/workflows/pages-deploy.yml)
[![Docker Build and Publish](https://github.com/kristianvld/bangs.fast/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/kristianvld/bangs.fast/actions/workflows/docker-publish.yml)
[![Sync Bang Datasets](https://github.com/kristianvld/bangs.fast/actions/workflows/dataset-sync.yml/badge.svg?branch=main)](https://github.com/kristianvld/bangs.fast/actions/workflows/dataset-sync.yml)

`bangs.fast` is a local bang redirect service that runs fully in the browser. It resolves `!bang` queries locally with cached data instead of sending every redirect through a backend, and supports multiple base sets of existing bangs: `Kagi`, `Kagi + Kagi Internal`, and `DuckDuckGo`.

The project is currently hosted on GitHub Pages at [https://bangs.fast](https://bangs.fast). Bang resolution happens locally in your browser; only the final redirect request goes directly to the destination site you choose.

## Main features

- Instant bang redirects with client-side lookup.
- Select from multiple base sets of existing bangs: `Kagi`, `Kagi + Kagi Internal`, and `DuckDuckGo`.
- Custom !bangs. Disable, overwrite, copy or add your own.
- Custom default search engine, compatible with any configured !bang.
- Share settings and configuration with a single link, easily import your settings to other devices.
- Offline first. After first visit, the browser will cache everything needed for local bang resolution.

## Why this exists

This project started as a direct inspiration from [unduck.link](https://unduck.link), however it was missing the ability to customize the bang list or change the default search engine.

## Hosted service

The hosted service for this project is a static page, and you can self-host the same build.

The public instance is available at [https://bangs.fast](https://bangs.fast), which is hosted on GitHub Pages ([https://kristianvld.github.io/bangs.fast](https://kristianvld.github.io/bangs.fast)).

The app also exposes OpenSearch metadata at `/opensearch.xml` for browsers that support one-click search-engine install.

### Self-host with Docker Compose

If you still wish to host your own instance, you can easily get started using the following docker compose file.

```yaml
services:
  bangs:
    image: ghcr.io/kristianvld/bangs.fast:latest
    ports:
      - "${PORT:-8080}:8080"
    restart: unless-stopped
```

### Local Docker testing (build from source)

Use the dev compose file when you want to test local changes in a container image:

```bash
docker compose -f docker-compose.dev.yml up --build
```

### Local development without Docker

```bash
bun install
bun run lint
bun run test
bun run dev
```

On first visit, the app fetches the selected base set (default: `Kagi` / `Kagi Community`).
You can switch presets any time between `Kagi`, `Kagi + Kagi Internal`, and `DuckDuckGo`.

Datasets are generated into `public/datasets` by:

```bash
bun run sync-bang-datasets
```

### Browser E2E tests (Playwright)

The repository includes Playwright browser tests under `tests/e2e` to verify:

- Service worker registration in editor mode.
- Dataset refresh when `version.json` reports updated dataset hashes.
- Query redirects avoid dataset/version fetches during search mode.

Install dependencies and Chromium once in your environment, then run:

```bash
bun install
bun run test:e2e:install
bun run test:e2e
```

For headed mode:

```bash
bun run test:e2e:headed
```

## GitHub Actions workflows

### Docker image publish

GitHub Actions at `.github/workflows/docker-publish.yml`:

- Builds the image on pull requests (no push).
- Builds and publishes to GHCR on `main` pushes and `v*` tags.
- Publishes multi-arch images for `linux/amd64` and `linux/arm64`.

### GitHub Pages publish

GitHub Actions at `.github/workflows/pages-deploy.yml`:

- Builds and deploys static files from `main` to GitHub Pages.
- Uses GitHub Pages base path automatically so project pages and custom domains both work.
- Publishes what Vite outputs in `dist`.

### Dataset sync

GitHub Actions at `.github/workflows/dataset-sync.yml`:

- Runs every 24 hours.
- Fetches and sanitizes `kagi-community`, `kagi-internal`, and `duckduckgo` datasets.
- Writes `public/datasets/*.json` + `public/datasets/manifest.json`.
- Commits and pushes dataset changes to `main` when updates are detected.

### Browser E2E

GitHub Actions at `.github/workflows/e2e.yml`:

- Runs on pull requests and pushes to `main`.
- Installs Chromium and executes Playwright E2E tests.
- Uploads `playwright-report` and `test-results` artifacts on every run.

One-time setup in GitHub repository settings:

1. Go to `Settings` -> `Pages`.
2. Under `Build and deployment`, set `Source` to `GitHub Actions`.

This repository includes `public/CNAME` set to `bangs.fast` for custom-domain Pages deployment. If you run a fork, change or remove that file.

## License

MIT. See `LICENSE`.
