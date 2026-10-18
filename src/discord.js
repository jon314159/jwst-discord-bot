import {TERMS, escapeMd, sleep} from './source.js';
export class DeliveryError extends Error {}
export class UncertainDelivery extends DeliveryError {}

export async function makePayload(image, day, channel) {
  const bytes = new TextEncoder().encode(`${channel}:${day}:${image.id}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const nonce = [...hash].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);
  const excerpt = image.caption.length > 1600 ? image.caption.slice(0,1599).replace(/\s+\S*$/,'')+'…' : image.caption;
  return {
    content:`Daily Webb image · ${day}\nArchive selection · originally released ${image.released}`,
    tts:false, allowed_mentions:{parse:[],users:[],roles:[],replied_user:false}, nonce, enforce_nonce:true,
    embeds:[{
      title:image.title.slice(0,256),url:image.sourceUrl,color:0x164a71,
      description:escapeMd(excerpt),image:{url:image.imageUrl},
      fields:[
        {name:'Full image credit',value:image.creditMarkdown,inline:false},
        {name:'Source and reuse',value:`[Original image and full caption](${image.sourceUrl}) · [ESA/Webb — CC BY 4.0](${TERMS})\nCaption: ESA/Webb. Image shown without modification.`,inline:false}
      ],footer:{text:'Independent daily archive bot · no ESA/NASA endorsement'}
    }]
  };
}

export async function sendDiscord(channel, token, body, fetcher = fetch, pause = sleep) {
  if (!/^\d{15,22}$/.test(channel) || !token || /\s/.test(token)) throw new DeliveryError('Invalid Discord channel or token configuration');
  const url = `https://discord.com/api/v10/channels/${channel}/messages`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetcher(url, {method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),
        headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json','User-Agent':'WebbDaily (https://esawebb.org/, 1.0)'},body:JSON.stringify(body)});
    } catch { throw new UncertainDelivery('Network interrupted POST; inspect channel before resolving'); }
    if (r.ok) {
      try { const data = await r.json(); if (!/^\d+$/.test(String(data.id))) throw new Error(); return String(data.id); }
      catch { throw new UncertainDelivery('Success response missing message ID; inspect channel'); }
    }
    if (r.status === 429) {
      let delay;
      try { delay = Number((await r.json()).retry_after); } catch { throw new DeliveryError('Invalid rate-limit response; no retry'); }
      if (attempt === 2 || !Number.isFinite(delay) || delay < 0 || delay > 60) throw new DeliveryError('Rate limit retry budget exhausted');
      await pause(delay*1000+100); continue;
    }
    await r.body?.cancel();
    if (r.status >= 500 || r.status === 408 || (r.status >= 300 && r.status < 400)) throw new UncertainDelivery(`Discord HTTP ${r.status}; inspect channel before resolving`);
    throw new DeliveryError(`Discord HTTP ${r.status}; check token/channel/permissions`);
  }
  throw new DeliveryError('Discord retry budget exhausted');
}
