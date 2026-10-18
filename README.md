# Daily Webb Discord bot

A Discord bot that posts one James Webb Space Telescope image each day using Cloudflare Workers and D1. It checks the newest releases in the [official ESA/Webb gallery][webb-gallery], then selects from the archive when there is no new image to share.

Posts include the original release date, an excerpt of the official caption, the full image credit, and a link to the source. Every post is labeled **Archive selection**, so an older image is never presented as a new release.

## Quick links

| Resource | Link |
| --- | --- |
| Browse the photos | [ESA/Webb image gallery][webb-gallery] |
| Create or manage a Discord application | [Discord Developer Portal][discord-portal] |
| Manage the Worker and database | [Cloudflare dashboard][cloudflare-dashboard] |
| Configuration template | [wrangler.jsonc](wrangler.jsonc) |
| Test results | [Validation record](VALIDATION.md) |

The [ESA/Webb RSS feed (XML)][webb-feed] is the machine-readable source used by the bot. It may display XML or download a feed file when opened in a browser. Use the gallery above to browse images.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Discord setup](#discord-setup)
- [Cloudflare deployment](#cloudflare-deployment)
- [Configuration](#configuration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Image sources and credits](#image-sources-and-credits)
- [Reference links](#reference-links)

## Features

- Daily posting at **12:00 America/New_York** by default, with daylight saving time support.
- Preference for the newest unseen Webb observations, followed by archive selections.
- Persistent D1 history that prevents repeat dates, image URLs, and variants from the same release.
- Full image credits and source links, with all Discord mentions disabled.
- Bounded retries for source requests and Discord rate limits.
- No always-on computer or Discord Gateway connection required.
- Zero third-party runtime dependencies; Wrangler and Miniflare are development tools.

The bot posts through Discord's REST API and may appear **offline** in the member list. This is normal.

## Requirements

- Node.js 22 or newer, npm, and Git.
- A Discord account with permission to install a bot in the destination server.
- A Cloudflare account with Workers and D1 enabled.

The daily workload is designed for Workers Free and D1 Free. See [Workers limits][workers-limits] and [D1 pricing][d1-pricing] for current allowances.

## Installation

```sh
git clone https://github.com/jon314159/jwst-discord-bot.git
cd jwst-discord-bot
npm ci
npm test
npm run check
```

Copy [wrangler.jsonc](wrangler.jsonc) to `wrangler.local.jsonc`. Use the local copy for your channel and database settings; it is excluded from Git.

`npm run check` builds the Worker without deploying it. You can also generate a message preview without a Discord token:

```sh
npm run preview
npm run preview -- --live
```

The first command uses a saved official fixture. `--live` reads the current ESA/Webb source. Neither command sends a Discord message.

## Discord setup

1. Open the [Discord Developer Portal][discord-portal] and create an application, such as **Daily Webb**.
2. On the **Bot** page, leave **Presence Intent**, **Server Members Intent**, and **Message Content Intent** off.
3. Under **Installation**, select **Guild Install** and the `bot` scope. Grant **View Channels**, **Send Messages**, and **Embed Links** only. The permission integer is `19456`.
4. Open the generated install link, select your server, and complete the authorization. Check that the bot appears in that server's member list, including the offline section.
5. In Discord, enable **User Settings > Advanced > Developer Mode**. Right-click the destination text channel and select **Copy Channel ID**. Set `DISCORD_CHANNEL_ID` in `wrangler.local.jsonc` to that ID.

Use an ordinary server text channel. Threads are not configured by this project. Check channel permission overrides if the bot cannot see or post in the channel.

You will create the bot token and store it as a Cloudflare secret during deployment below. No privileged intents, Administrator permission, message history access, or slash command registration are required.

## Cloudflare deployment

First, open **Compute > Workers & Pages** in the [Cloudflare dashboard][cloudflare-dashboard] to complete any initial Workers setup. The Worker's public `workers.dev` address can remain disabled; Cron Triggers handle delivery.

### 1. Sign in

```sh
npx wrangler login --scopes account:read user:read workers_scripts:write d1:write workers_tail:read
```

Complete the sign-in in your browser. These scopes cover account information, Worker deployment, D1, and logs.

### 2. Create the database

```sh
npx wrangler d1 create jwst-discord-bot --update-config false --config wrangler.local.jsonc
```

Copy the returned `database_id` into the D1 entry in `wrangler.local.jsonc`, replacing the all-zero placeholder. Keep its binding name as `DB`.

Apply the schema:

```sh
npx wrangler d1 migrations apply jwst-discord-bot --remote --config wrangler.local.jsonc
```

### 3. Deploy with posting disabled

Leave `DELIVERY_ENABLED` set to `"false"` and deploy:

```sh
npx wrangler deploy --config wrangler.local.jsonc
```

### 4. Add the bot token

In the Discord Developer Portal, open your application's **Bot** page and use **Reset Token** to create a token. Store it directly in Cloudflare using the hidden prompt:

```sh
npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.local.jsonc
```

You can also use **Worker > Settings > Variables and Secrets > Add** in the Cloudflare dashboard. Choose **Secret**, use the name `DISCORD_BOT_TOKEN`, enter the value, and deploy the change.

Keep tokens out of source files, command arguments, and Git. Use a bot token, never a Discord user-account token.

### 5. Start posting

Confirm the channel ID, set `DELIVERY_ENABLED` to `"true"` in `wrangler.local.jsonc`, and deploy again:

```sh
npx wrangler deploy --config wrangler.local.jsonc
```

The first run within today's scheduled posting window can post immediately. A successful post consumes that date's slot, so subsequent runs cannot post another image that day.

Cron changes can take [up to 15 minutes to propagate][cloudflare-cron]. The HTTP handler returns 404; there is no public posting endpoint.

## Configuration

Set these values in `wrangler.local.jsonc`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `DELIVERY_ENABLED` | `"false"` | Set to `"true"` to enable posting. |
| `DISCORD_CHANNEL_ID` | Empty | Destination server text channel ID. |
| `TIMEZONE` | `"America/New_York"` | IANA timezone used for the daily date and time. |
| `DAILY_TIME` | `"12:00"` | Local posting time in `HH:MM` format. |
| `CATCHUP_HOURS` | `"6"` | Number of hours after the scheduled time in which today's post may run. |

The default cron, `0 * * * *`, wakes the Worker hourly. The Worker checks local time and posts once per date. Noon in New York is 16:00 UTC in summer and 17:00 UTC in winter.

For a different posting minute, update the cron as well as `DAILY_TIME`. For example, use `30 * * * *` for `12:30` in New York. Timezones with half-hour or quarter-hour UTC offsets need the corresponding UTC cron minute.

Missed previous dates are not replayed. The catch-up window's end is exclusive. Repeated times during daylight saving fall-back share one daily slot; a nonexistent local time is picked up by the next eligible cron tick.

To pause delivery, set `DELIVERY_ENABLED` to `"false"` and redeploy. Keep the D1 database to preserve image history.

## Testing

`npm test` runs in Miniflare's local Workers runtime with native HTMLRewriter, local D1, source fixtures, and mocked Discord requests. It covers credits, image filtering, scheduling, concurrent runs, no-repeat history, rate limits, and interrupted deliveries. See the [validation record](VALIDATION.md) for results.

### Check the destination without posting

Keep `DELIVERY_ENABLED` at `"false"` and add these optional values to the local configuration:

- `SETUP_CHECK_ID`: a unique name of 8–64 letters, digits, or hyphens.
- `EXPECTED_BOT_ID`: your application's bot ID.
- `EXPECTED_GUILD_NAME`: the expected server name.
- `EXPECTED_CHANNEL_NAME`: the expected channel name, without `#`.

The next scheduled run checks the bot, channel, and server using Discord GET requests. It saves the result in D1 `meta` under `setup:<SETUP_CHECK_ID>`. A check ID is cached; use a new one to recheck after correcting permissions. Remove `SETUP_CHECK_ID` or set it to an empty string when finished.

### Limit a live test to one date

Set `SINGLE_POST_DATE` to the intended local date in `YYYY-MM-DD` format before enabling delivery. The usual time window and daily reservation still apply, and later dates cannot post while this setting remains set.

After testing, disable delivery or remove `SINGLE_POST_DATE` to continue daily posting.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Bot appears offline | Expected: the bot uses REST and has no presence connection. |
| Discord `401` | Check the bot token stored in `DISCORD_BOT_TOKEN`. |
| Discord `403` or `Missing Access` | Install the bot in the correct server and check the destination channel's permissions. |
| No post yet | Check `DELIVERY_ENABLED`, the local posting window, Cron propagation, and whether today's slot was already handled. |
| Source selection skipped | Check the official source and the saved reason. Changed metadata, unavailable sources, and archive exhaustion skip the day rather than repeat an image. |
| Delivery is `pending` or `uncertain` | Inspect the channel and reconcile the record as described below. |
| Database belongs to another channel | Use a separate D1 database when changing channels. |

Inspect recent delivery records:

```sh
npx wrangler d1 execute jwst-discord-bot --remote --config wrangler.local.jsonc --command "SELECT day,image_id,status,message_id,note FROM deliveries ORDER BY day DESC LIMIT 14"
```

### Reconcile an interrupted delivery

The Worker reserves an image before sending it. If a network failure or interrupted run leaves the outcome unclear, it stops further delivery to prevent duplicates.

Pause delivery and inspect the actual Discord channel. If the post exists, copy its message ID and mark that date as sent:

```sql
UPDATE deliveries
SET status='sent', message_id='ACTUAL_MESSAGE_ID',
    note='Manually reconciled', updated=datetime('now')
WHERE day='YYYY-MM-DD' AND status IN ('pending','uncertain');
```

If you confirm no post exists, mark the date as failed:

```sql
UPDATE deliveries
SET status='failed', note='Confirmed no delivery', updated=datetime('now')
WHERE day='YYYY-MM-DD' AND status IN ('pending','uncertain');
```

Run the appropriate query in the D1 dashboard or with `wrangler d1 execute --file`. Resolved dates remain consumed. Never delete a successful record to retry a post.

## Image sources and credits

The bot uses the [ESA/Webb gallery][webb-gallery] and [RSS feed (XML)][webb-feed]. RSS provides image links and dates, but the full credit comes from each original image page. Eligible entries must have `Type: Observation`, identify Webb data, and include a title, caption, release date, credit, and official HTTPS image URL. Illustrations, spectra, charts, spacecraft images, and apparent restrictive rights exceptions are excluded. Webb/Hubble composites can qualify when the source identifies Webb data.

D1 tracks the image URL and release family so clean, annotated, and alternate variants from the same `weic` or `potm` release are not posted separately. This is metadata-based filtering, not visual duplicate detection. Rejected metadata is cached for 30 days and then reconsidered.

[ESA/Webb's reuse terms][webb-reuse] generally release images and text under [CC BY 4.0][cc-by], subject to per-image exceptions. Posts preserve the full visible image credit and its links, credit captions to ESA/Webb, and link to the complete caption. Shortened captions end with an ellipsis. Image files are displayed without modification.

This is an independent project and does not imply endorsement by NASA, ESA, CSA, or STScI.

## Reference links

- [Discord: Create Message API][discord-create-message]
- [Discord: API rate limits][discord-rate-limits]
- [Cloudflare: Cron Triggers and scheduling][cloudflare-cron]
- [Cloudflare: Workers limits][workers-limits]
- [Cloudflare: D1 pricing and free allowances][d1-pricing]

[webb-gallery]: https://esawebb.org/images/
[webb-feed]: https://esawebb.org/images/feed/
[discord-portal]: https://discord.com/developers/applications
[cloudflare-dashboard]: https://dash.cloudflare.com/
[webb-reuse]: https://esawebb.org/copyright/
[cc-by]: https://creativecommons.org/licenses/by/4.0/
[discord-create-message]: https://docs.discord.com/developers/resources/message#create-message
[discord-rate-limits]: https://docs.discord.com/developers/topics/rate-limits
[cloudflare-cron]: https://developers.cloudflare.com/workers/configuration/cron-triggers/
[workers-limits]: https://developers.cloudflare.com/workers/platform/limits/
[d1-pricing]: https://developers.cloudflare.com/d1/platform/pricing/
