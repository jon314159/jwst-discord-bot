# Initial release validation — 2026-10-18

- **16/16 tests passed** in the local Cloudflare Workers runtime (Miniflare/workerd), with native HTMLRewriter and real local D1 storage. Tests used fixture sources and mocked Discord; no Discord account/token was involved.
- **Wrangler deployment dry run passed.** Bundle: 20.31 KiB, 7.03 KiB gzip. Delivery binding remained `false`, channel remained empty, database ID remained the all-zero placeholder. This was not a live deployment.
- **npm dependency audit: 0 vulnerabilities** at validation time. Runtime has no third-party dependencies; development dependencies are pinned in `package-lock.json` and were obtained from the official npm registry.
- **Live read-only source preview passed** using the actual Worker parser against the current official RSS and original image page. Selected [FRB 20240304B (NIRCam clean image)](https://esawebb.org/images/weic2621d/), originally released **2026-10-08**. The generated preview labeled it as an archive selection on 2026-10-18 and retained the full credit: NASA, ESA, CSA, STScI, T. Nanayakkara (USYD). Image Processing: J. DePasquale (STScI).
- Source fixture checks cover the live-discovered RSS shape, archive gallery and metadata. Additional tests cover observation/rights exclusions, linked credit, archived dates, New York summer/winter and DST-transition dates, repeated/concurrent daily runs, release-variant deduplication, archive fallback, temporary rejection caching, source failures, interrupted/ambiguous POSTs, crash reservations, channel pinning, bounded 429 retries and redirect refusal.
- Public-file review included the complete intended file list and initial Git history. No real Discord token/channel, Cloudflare credential/account/database configuration, local runtime state or unrelated projects were included. The Git author uses a GitHub noreply address.

Not verified yet: live Cloudflare account quotas/CPU behavior, deployed Cron Trigger execution, actual Discord credentials/channel permissions, or real delivery. Those require the owner's secure setup and delivery authorization. Keep delivery disabled until then.

## Guided-setup safety additions — 2026-10-18

- **20/20 local tests passed**, including the new GET-only destination verification, identity mismatch rejection, cached setup checks, disabled-delivery requirement and single-day test guard.
- Updated dry-run bundle: **23.35 KiB / 7.75 KiB gzip**. No third-party runtime dependency was added.
- Setup verification and real deployment details are intentionally excluded from the public configuration. Owner-managed tokens are entered directly into Cloudflare's encrypted secret form and are never copied into this repository.

## End-to-end deployment validation — 2026-10-18

- **21/21 local tests passed**, including a regression for Workers' native `fetch` receiver requirements. The source HTTP client wraps injected fetch functions so they are called without binding them to the client instance.
- A read-only check inside Cloudflare verified the configured bot identity, server and channel using the owner's encrypted secret, without retrieving its value into the development environment.
- An explicitly authorized live test successfully fetched an official ESA/Webb observation, posted it to the confirmed channel, and persisted Discord's successful message ID in D1. Private destination identifiers and message links are intentionally omitted here.
- Recurring delivery is controlled by the owner's ignored local deployment configuration. The public template remains disabled with no channel or account identifiers.
