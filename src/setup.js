// Optional, read-only setup check. No Discord POST route or token-reveal endpoint.
export async function verifyDestination(env, fetcher = fetch) {
  const channel = env.DISCORD_CHANNEL_ID, token = env.DISCORD_BOT_TOKEN;
  if (!/^\d{15,22}$/.test(channel || '') || !token || /\s/.test(token)) throw new Error('Missing channel or secure token');
  const get = async (path,stage) => {
    let r;
    try {r = await fetcher(`https://discord.com/api/v10${path}`,{method:'GET',redirect:'manual',
      signal:AbortSignal.timeout(20000),headers:{Authorization:`Bot ${token}`,'User-Agent':'WebbDaily (https://esawebb.org/, 1.0)'}});}
    catch {throw new Error('Discord read-only check was interrupted');}
    if (!r.ok) {
      let code = '';
      try {const data = await r.json(); if (Number.isInteger(data.code)) code = ` (code ${data.code})`;} catch {}
      throw new Error(`Discord ${stage} check HTTP ${r.status}${code}`);
    }
    try {return await r.json();} catch {throw new Error('Discord read-only check returned invalid metadata');}
  };
  const bot = await get('/users/@me','bot identity');
  if (!bot.bot || !/^\d+$/.test(bot.id || '') || (env.EXPECTED_BOT_ID && bot.id !== env.EXPECTED_BOT_ID)) throw new Error('Bot identity does not match the expected application');
  const destination = await get(`/channels/${channel}`,'channel access');
  if (destination.id !== channel || destination.type !== 0 || !/^\d+$/.test(destination.guild_id || '')) throw new Error('Destination is not the expected server text channel');
  const guild = await get(`/guilds/${destination.guild_id}`,'server identity');
  if (guild.id !== destination.guild_id) throw new Error('Server identity check failed');
  if (env.EXPECTED_CHANNEL_NAME && destination.name !== env.EXPECTED_CHANNEL_NAME) throw new Error('Channel name differs from the confirmed destination');
  if (env.EXPECTED_GUILD_NAME && guild.name !== env.EXPECTED_GUILD_NAME) throw new Error('Server name differs from the confirmed destination');
  return {status:'destination-verified',botId:bot.id,botName:bot.username,channelId:channel,
    channelName:destination.name,guildId:guild.id,guildName:guild.name,checkedAt:new Date().toISOString()};
}

export async function verifyOnce(env, fetcher = fetch) {
  if (env.DELIVERY_ENABLED === 'true') throw new Error('Setup checks require delivery disabled');
  if (!/^[a-z0-9-]{8,64}$/i.test(env.SETUP_CHECK_ID || '')) throw new Error('Invalid setup check ID');
  const key = `setup:${env.SETUP_CHECK_ID}`;
  const cached = await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first();
  if (cached) return JSON.parse(cached.value);
  let result;
  try {result = await verifyDestination(env,fetcher);} catch(e) {result = {status:'destination-check-failed',reason:e.message};}
  await env.DB.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').bind(key,JSON.stringify(result)).run();
  return result;
}
