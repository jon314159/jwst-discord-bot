# Daily Webb Discord bot

A scheduled Cloudflare Worker posts one James Webb telescope image to one Discord text channel each day. It prefers the newest unseen eligible images from the official [ESA/Webb image feed](https://esawebb.org/images/feed/), then walks the [official archive](https://esawebb.org/images/). The default schedule is noon **America/New_York**, including daylight saving time.

Every post says **Archive selection**, gives the original release date, includes an excerpt of the official caption, preserves the full image credit, and links the original image page and reuse terms. This is an independent bot; NASA/ESA/STScI do not endorse it. Images are not necessarily newly released every day.

**Current state: code prepared; delivery disabled.** No Discord application, token, installation, Cloudflare database, or live deployment has been created by this project. Creating credentials, granting account access, installing the bot, and enabling real delivery require the owner's explicit setup/approval. The repository itself can be public; secrets and runtime state must remain private.

## Architecture

- JavaScript Worker, zero production npm dependencies; native `fetch`, `HTMLRewriter`, `Intl`, Web Crypto, and D1.
- Discord bot account through API v10 REST. No Gateway connection, message reader, webhooks, slash command registration, or privileged intents. The bot may appear offline in Discord because no presence connection is opened.
- D1 reserves a civil-date slot before source discovery, and an image before the Discord POST. Concurrent invocations and restarts cannot intentionally duplicate the date, image URL, or release family. Clean/annotated variants from the same `weic`/`potm` release count as one family. Visually similar pictures from different official releases can still occur; there is no perceptual-image fingerprinting.
- A pending/uncertain POST blocks subsequent delivery until reconciled. This chooses duplicate prevention over automatic retransmission after an ambiguous network failure; it does not promise distributed exactly-once delivery.
- Each source request has a 20-second timeout, at most three attempts, a 2 MB response limit and one-second spacing. Discovery has a 32-request hard budget, at most six detail inspections and 20 archive pages. Discord 429s honor `retry_after` for up to three attempts and 60 seconds per wait. Other ambiguous POST outcomes are never retried automatically.
- No-repeat history is never reset automatically. Exhaustion, changed metadata, a rights exception, or a source outage skips the day instead of reposting old content. A failed/skipped date stays consumed; the next date can try again. A killed run in `selecting` cannot have posted, so it does not block future dates; a killed run in `pending` does.
- Ineligible image IDs are cached for 30 days, so a feed full of charts cannot permanently consume every daily inspection budget. They are reconsidered later in case official metadata was corrected.
- The production HTTP handler always returns 404, and `workers.dev`/preview URLs are disabled. Tests/preview use a separate local harness that is not in the deployment bundle.

## Local check — no Discord or Cloudflare account needed

Install Node.js 22 or newer with npm, then run inside this directory:

```sh
npm ci
npm test
npm run check
npm run preview
# Optional read-only GETs to official ESA/Webb; never contacts Discord:
npm run preview -- --live
```

Miniflare runs tests in the actual local Workers runtime with native HTMLRewriter and local D1. Discord POSTs are mocks. Tests include source fixtures, observation/rights filters, credits, DST, races, restart history, uncertain outcomes, HTTP refusal and rate limits. `npm run check` is a dry-run build, not a deployment. Install tools only in this project; no shared Hermes environment is needed.

## Discord setup — owner action, when approved

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Create an application such as **Daily Webb**. On its **Bot** page, configure its bot user and generate/reset its bot token only when ready for secure handoff. Leave **Presence**, **Server Members**, and **Message Content** privileged intents off. Do not enable public installation unless you want other servers to install it.
2. Under **Installation**, use **Guild Install** with the `bot` scope. Grant only **View Channel**, **Send Messages**, and **Embed Links** (permission integer `19456`). Do not grant Administrator, Manage Messages, Read Message History, Attach Files, or mention-everyone permission. This implementation only supports an ordinary server text channel; threads need additional permissions and are not configured here.
3. Use the generated install link and select the intended server yourself. This OAuth/server installation grants ongoing access and should be approved by the server owner. The application ID is public; the bot token is secret.
4. Supply the destination text channel ID after it is chosen: Discord **User Settings → Advanced → Developer Mode**, then right-click the text channel → **Copy Channel ID**. Check channel overrides allow the three permissions above.
5. Enter the token directly into Cloudflare's encrypted secret interface or the Wrangler hidden prompt in the next section. Never paste it into chat, source code, Git, command arguments, screenshots or logs. Do not use a Discord user-account token. Rotate a bot token if it is ever exposed.

## Cloudflare free-tier setup — owner action, when approved

Use **Workers Free** and **D1 Free**. No domain, paid Worker plan, subscription upgrade, third-party host, or always-on PC is required. Confirm your account is on the free plan and review its quotas. Source requests and CPU use depend on archive depth; this has been built/tested locally, not measured on a live account. Cloudflare's free CPU limit is 10 ms per invocation; native HTMLRewriter avoids a JavaScript DOM dependency. A production CPU/quota error should be diagnosed before enabling delivery; this project does not automatically upgrade or incur paid-plan access.

1. Sign in yourself at the [Cloudflare dashboard](https://dash.cloudflare.com/). When explicitly approved, run `npx wrangler login` and review the requested OAuth grant yourself, or use an already approved account. Never transmit an account API token through chat. No automatic account authorization is part of this project.
2. Create the small database and record its returned ID:

   ```sh
   npx wrangler d1 create jwst-discord-bot
   ```

3. Replace only the all-zero `database_id` placeholder in `wrangler.jsonc`. An actual database ID/account setup and real channel ID belong in an ignored local copy, not a public commit. For example, copy to `wrangler.local.jsonc`, replace its placeholder, and pass `--config wrangler.local.jsonc` on all subsequent commands. Set its `DISCORD_CHANNEL_ID` to the chosen channel. Keep `DELIVERY_ENABLED` as `"false"`.
4. Apply the schema and deploy while disabled:

   ```sh
   npx wrangler d1 migrations apply jwst-discord-bot --remote --config wrangler.local.jsonc
   npx wrangler deploy --config wrangler.local.jsonc
   ```

5. Store the Discord token securely. Cloudflare Dashboard → **Workers & Pages → jwst-discord-bot → Settings → Variables and Secrets → Add → Secret**, name `DISCORD_BOT_TOKEN`; enter the token directly. Alternatively use the hidden prompt (do not append the token):

   ```sh
   npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.local.jsonc
   ```

6. Verify the intended channel, token, source preview, deployment and permissions. Obtain approval to start posting. Then set `DELIVERY_ENABLED` to `"true"` in the ignored local config and redeploy it. Never test with a real POST before the channel and delivery approval are supplied. The first enabled run in the current day's noon-to-6pm window can post that day.
7. Inspect the next scheduled invocation and D1 record. `sent` with a message ID confirms the request succeeded. Cron changes may take several minutes to propagate, and scheduling is best effort rather than second-exact. There is no forced-post public endpoint.

The hourly UTC cron is only a wake-up; the Worker checks local civil time using `TIMEZONE`. For a different `DAILY_TIME`, set `HH:MM` and adjust the cron minute to `MM` (e.g. `30 * * * *` for `12:30`). Non-whole-hour-offset zones may require a different UTC cron minute. With the default settings, noon is 16:00 UTC in New York summer and 17:00 UTC in winter. Only today's date is eligible; missed previous dates are not replayed. `CATCHUP_HOURS` defaults to 6, and the end of that window is exclusive. Repeated times on DST fall-back still share one date slot; a nonexistent scheduled local time is picked up at the first cron tick after it within the grace window.

## Operations and reconciliation

Pause by setting `DELIVERY_ENABLED` to `"false"` in the local config and redeploying, or remove its Cron Trigger. Keep the D1 database to preserve no-repeat history. Check status without reading Discord messages:

```sh
npx wrangler d1 execute jwst-discord-bot --remote --config wrangler.local.jsonc --command "SELECT day,image_id,status,message_id,note FROM deliveries ORDER BY day DESC LIMIT 14"
```

If a record is `pending` or `uncertain`, **first inspect the actual Discord channel yourself**. Disable delivery while reconciling. If the post exists, copy its message ID and mark that exact date as sent. If you confirm it does not exist, mark the date failed. Replace the example date/ID with inspected values:

```sql
UPDATE deliveries SET status='sent',message_id='ACTUAL_MESSAGE_ID',note='Owner reconciled',updated=datetime('now')
WHERE day='YYYY-MM-DD' AND status IN ('pending','uncertain');
-- OR, only after confirming no post exists:
UPDATE deliveries SET status='failed',note='Owner confirmed no delivery',updated=datetime('now')
WHERE day='YYYY-MM-DD' AND status IN ('pending','uncertain');
```

Run the chosen SQL through D1's dashboard query console or `wrangler d1 execute --file` from an ignored local file. Never delete a successful record to retry a day. Resolved dates remain consumed. No bot message-reading permission is needed. If changing to another channel, use a separate database; the first enabled run pins the database to its channel to prevent accidental routing changes.

For a source failure, inspect the source and parser before changing the adapter. For Discord 401/403, fix the token/channel permissions rather than repeatedly invoking it. Logs contain status or a generic failure message, never tokens, request headers or complete environment dumps. Keep database exports, local configuration and secrets out of Git.

## Sources and reuse

The official RSS endpoint and archive pagination were verified with real read-only GETs on 2026-10-18. The server rejected the default Python user agent but accepted the browser-compatible bot user agent used here. RSS supplies links/dates/captions/enclosures but **does not supply full credits**; the bot therefore validates the original detail page. It requires `Type: Observation`, positive Webb identification, title, caption, full credit, release date and an official HTTPS image host. Illustrations, spectra, charts, spacecraft and apparent restrictive rights exceptions are excluded. Selection is conservative metadata filtering, not computer vision; Webb/Hubble composites can qualify when the source identifies Webb data.

[ESA/Webb's reuse terms](https://esawebb.org/copyright/) generally release image/text content under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) with each full credit shown unaltered and online credit links active; individual exceptions take precedence. The bot preserves credit text/link wording and visibly credits caption text to ESA/Webb. Captions may be shortened with an ellipsis and the complete caption remains linked. It uses official hosted image URLs without editing the image binary, and does not use ESA logos.

Technical references: [Discord Create Message](https://docs.discord.com/developers/resources/message#create-message), [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
