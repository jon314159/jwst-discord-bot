import {SourceHTTP, chooseImage, SourceError} from './source.js';
import {D1State} from './state.js';
import {makePayload, sendDiscord, UncertainDelivery} from './discord.js';

export function config(env) {
  const timeZone = env.TIMEZONE || 'America/New_York', dailyTime = env.DAILY_TIME || '12:00';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error('DAILY_TIME must be HH:MM');
  new Intl.DateTimeFormat('en-US',{timeZone}).format();
  const catchupHours = Number(env.CATCHUP_HOURS || 6);
  if (!Number.isFinite(catchupHours) || catchupHours < 1 || catchupHours > 12) throw new Error('CATCHUP_HOURS must be 1..12');
  return {timeZone,dailyTime,catchupHours};
}
export function dueDay(now, cfg) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:cfg.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  const [h,m] = cfg.dailyTime.split(':').map(Number);
  const elapsed = Number(parts.hour)*60+Number(parts.minute) - (h*60+m);
  return elapsed >= 0 && elapsed < cfg.catchupHours*60 ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export async function run(env, {now = new Date(), http = new SourceHTTP(), fetcher = fetch, pause, state = new D1State(env.DB)} = {}) {
  if (env.DELIVERY_ENABLED !== 'true') return {status:'disabled'};
  if (!/^\d{15,22}$/.test(env.DISCORD_CHANNEL_ID || '') || !env.DISCORD_BOT_TOKEN || /\s/.test(env.DISCORD_BOT_TOKEN)) throw new Error('Channel and secure Discord token required before enabling delivery');
  const day = dueDay(now, config(env));
  if (!day) return {status:'outside-window'};
  if (!await state.claim(day, env.DISCORD_CHANNEL_ID)) return {status:'already-handled',day};
  let image;
  try { image = await chooseImage(http, await state.used(), day, (id,reason)=>state.reject(id,reason)); }
  catch (e) {
    await state.finish(day,'skipped', e instanceof SourceError ? e.message : 'Source parsing failed');
    return {status:'source-skipped',day};
  }
  const body = await makePayload(image,day,env.DISCORD_CHANNEL_ID);
  // Persist the reservation BEFORE any POST. A killed invocation then blocks further sends.
  await state.reserve(day,image,body.nonce);
  let messageId;
  try { messageId = await sendDiscord(env.DISCORD_CHANNEL_ID,env.DISCORD_BOT_TOKEN,body,fetcher,pause); }
  catch(e) {
    await state.finish(day,e instanceof UncertainDelivery ? 'uncertain' : 'failed',e.message);
    throw e;
  }
  await state.finish(day,'sent','',messageId);
  return {status:'sent',day,image:image.id,messageId};
}

export default {
  // No public control or posting endpoint. workers.dev and preview URLs are disabled.
  fetch() { return new Response('Not found',{status:404}); },
  async scheduled(controller, env) {
    controller.noRetry(); // Retries of a POST must follow our durable state, never platform replay.
    try { console.log(JSON.stringify(await run(env))); }
    catch { console.error('Daily Webb run stopped; check D1 status and Cloudflare invocation diagnostics. No credentials logged.'); }
  }
};
