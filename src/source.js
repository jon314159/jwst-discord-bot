export const ROOT = 'https://esawebb.org';
export const FEED = `${ROOT}/images/feed/`;
export const TERMS = `${ROOT}/copyright/`;
const UA = 'Mozilla/5.0 (compatible; WebbDaily/1.0; educational image bot)';
export class SourceError extends Error {}
export class Ineligible extends SourceError {}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const normalize = s => decode(s).replace(/\s+/g, ' ').trim();

export function decode(s) {
  const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—',deg:'°',copy:'©'};
  return String(s).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return named[entity] ?? whole;
    const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
  });
}

export function official(url) {
  try {
    const p = new URL(url);
    return p.protocol === 'https:' && ['esawebb.org','www.esawebb.org','cdn.esawebb.org'].includes(p.hostname)
      && !p.username && !p.password && (!p.port || p.port === '443');
  } catch { return false; }
}
export function imageId(url) {
  if (!official(url) || !/^\/images\/[a-z0-9_-]+\/$/i.test(new URL(url).pathname)) throw new Ineligible('Invalid image page URL');
  return new URL(url).pathname.split('/')[2];
}
export const family = id => id.toLowerCase().replace(/^((?:weic|potm)\d+)[a-z]+$/, '$1');
export const escapeMd = s => s.replace(/[\\`*_{}\[\]()~|<>]/g, '\\$&');

export class SourceHTTP {
  constructor(fetcher = fetch, pause = sleep) { this.fetcher = fetcher; this.pause = pause; this.last = 0; this.calls = 0; }
  async get(url) {
    if (!official(url)) throw new SourceError('Refused nonofficial URL');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++this.calls > 32) throw new SourceError('Source request budget exhausted');
      await this.pause(Math.max(0, 1000 - (Date.now() - this.last)));
      this.last = Date.now();
      let r;
      try { r = await this.fetcher(url, {headers:{'User-Agent':UA}, redirect:'manual', signal:AbortSignal.timeout(20000)}); }
      catch { if (attempt === 2) throw new SourceError('Official source unavailable after 3 attempts'); await this.pause(1000 * 2 ** attempt); continue; }
      // Follow only explicitly checked official redirects, without credentials.
      for (let n = 0; r.status >= 300 && r.status < 400 && n < 3; n++) {
        const next = new URL(r.headers.get('location') || '', url).href;
        await r.body?.cancel();
        if (!official(next) || ++this.calls > 32) throw new SourceError('Unsafe redirect or request budget');
        r = await this.fetcher(next, {headers:{'User-Agent':UA}, redirect:'manual', signal:AbortSignal.timeout(20000)});
        url = next;
      }
      if ([429,500,502,503,504].includes(r.status) && attempt < 2) {
        const header = r.headers.get('retry-after');
        const delay = header === null ? 2 ** attempt : Number(header);
        await r.body?.cancel();
        if (!Number.isFinite(delay) || delay < 0 || delay > 60) throw new SourceError('Source requested a later retry');
        await this.pause(delay * 1000); continue;
      }
      if (!r.ok) { await r.body?.cancel(); throw new SourceError(`Official source HTTP ${r.status}`); }
      if (Number(r.headers.get('content-length')) > 2_000_000) { await r.body?.cancel(); throw new SourceError('Source too large'); }
      // Enforce a streaming limit even for chunked bodies; never buffer an unbounded response.
      const reader = r.body.getReader(), chunks = []; let length = 0;
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 2_000_000) { await reader.cancel(); throw new SourceError('Source too large'); }
        chunks.push(value);
      }
      const raw = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder().decode(raw);
    }
    throw new SourceError('Source retry budget exhausted');
  }
}

// Deliberately strict adapter for the observed official RSS 2.0 format; no external entities.
export function feedLinks(xml) {
  if (!/<rss\b/.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SourceError('Official RSS format changed');
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const read = tag => normalize((match[1].match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1'));
    const url = read('link'), title = read('title'), released = Date.parse(read('pubDate'));
    try { imageId(url); if (Number.isFinite(released)) items.push({url,title,released}); } catch {}
  }
  items.sort((a,b) => b.released-a.released || Number(/clean/i.test(b.title))-Number(/clean/i.test(a.title)) || Number(/annotat/i.test(a.title))-Number(/annotat/i.test(b.title)));
  if (!items.length) throw new SourceError('No valid RSS images');
  return [...new Set(items.map(x => x.url))];
}

export async function archiveLinks(html) {
  const links = []; let gallery = false;
  await new HTMLRewriter().on('#jGallery', {element(){gallery = true;}}).on('#jGallery a[href]', {element(e){
    const url = new URL(e.getAttribute('href'), ROOT).href;
    try { imageId(url); links.push(url); } catch {}
  }}).transform(new Response(html)).text();
  if (!gallery) throw new SourceError('Official archive format changed');
  return [...new Set(links)];
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function releaseDate(s) {
  const m = s.match(/^(\d{1,2}) ([A-Z][a-z]+) (\d{4}), \d{2}:\d{2}$/);
  const month = MONTHS.indexOf(m?.[2]);
  if (!m || month < 0) throw new Ineligible('Missing release date');
  const value = `${m[3]}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) throw new Ineligible('Invalid release date');
  return value;
}

export async function parseDetail(url, html) {
  const id = imageId(url), rows = {}; let title = '', credit = '', imageUrl = '', observation = '', section = '', caption = '';
  let row, paragraph, afterTitle = false, link;
  const creditLinks = [];
  const rewriter = new HTMLRewriter()
    .on('h1', {element(){afterTitle = true;}, text(t){title += t.text;}})
    .on('.credit', {text(t){credit += t.text;}})
    .on('.credit a[href]', {element(e){link = {label:'',href:new URL(e.getAttribute('href'),ROOT).href}; const current = link; e.onEndTag(()=>creditLinks.push(current));},text(t){if (link) link.label += t.text;}})
    .on('meta[property="og:image:secure_url"]', {element(e){imageUrl = e.getAttribute('content') || '';}})
    .on('#object_observation_div', {text(t){observation += t.text;}})
    .on('.left-column', {text(t){section += t.text;}})
    .on('.left-column p', {element(e){
      paragraph = afterTitle && !caption ? {value:''} : null;
      const current = paragraph;
      e.onEndTag(()=>{const p = normalize(current?.value || ''); if (!caption && p && !p.startsWith('[')) caption = p;});
    },text(t){if (paragraph) paragraph.value += t.text;}})
    .on('tr', {element(e){row = {key:'',value:''}; const current = row; e.onEndTag(()=>{if(current.key) rows[normalize(current.key).replace(/:$/,'').toLowerCase()] = normalize(current.value);});}})
    .on('tr th', {text(t){if(row) row.key += t.text;}})
    .on('tr td', {text(t){if(row) row.value += t.text;}});
  await rewriter.transform(new Response(html)).text();
  title = normalize(title); credit = normalize(credit);
  if (!title || !credit || !caption || !imageUrl) throw new Ineligible('Missing title, credit, caption, or image');
  if (rows.type?.toLowerCase() !== 'observation') throw new Ineligible('Not an observation');
  if (!/\bWebb\b|\bJWST\b/i.test(`${title} ${caption} ${normalize(observation)}`)) throw new Ineligible('No positive Webb identification');
  if (/illustration|artist.?s (concept|impression)|\bspectr(um|a)\b|\bgraphic\b|\bchart\b|\bschematic\b|\bdiagram\b|\bcomparison\b/i.test(title)
      || /\b(graphics|illustrations|spacecraft|launch)\b/i.test(rows.category || '')) throw new Ineligible('Not a telescope image');
  if (/all rights reserved|permission required|not (covered|released|available)|copyright restricted|©/i.test(normalize(section))) throw new Ineligible('Possible rights exception requires review');
  if (!official(imageUrl) || !/\.(jpg|jpeg|png)$/i.test(new URL(imageUrl).pathname)) throw new Ineligible('Unexpected image URL');
  let creditMarkdown = escapeMd(credit);
  for (const a of creditLinks) {
    if (/^https?:$/.test(new URL(a.href).protocol)) creditMarkdown = creditMarkdown.replace(escapeMd(normalize(a.label)), `[${escapeMd(normalize(a.label))}](${a.href.replace(/\)/g,'%29')})`);
  }
  if (creditMarkdown.length > 1024) throw new Ineligible('Full credit exceeds Discord limit');
  return {id,family:family(id),title,caption,credit,creditMarkdown,released:releaseDate(rows['release date'] || ''),sourceUrl:`${ROOT}/images/${id}/`,imageUrl};
}

export async function chooseImage(http, used, today, onReject = async()=>{}) {
  const tried = new Set(); let details = 0;
  const inspect = async links => {
    for (const url of links) {
      const id = imageId(url);
      if (tried.has(url) || used.families.has(family(id)) || used.rejected?.has(id)) continue;
      tried.add(url);
      if (++details > 6) throw new SourceError('Metadata inspection budget reached; no image posted');
      let image;
      try { image = await parseDetail(url, await http.get(url)); }
      catch(e) { if(e instanceof Ineligible) { await onReject(id,e.message); used.rejected?.add(id); continue; } throw e; }
      if (image.released <= today && !used.urls.has(image.imageUrl)) return image;
    }
    return null;
  };
  try { const image = await inspect(feedLinks(await http.get(FEED))); if (image) return image; }
  catch (e) { if (details > 6) throw e; }
  // Full archive remains available after all current feed releases have been used.
  // 20 pages x 50 items covers the observed 695-image archive; no repeat on exhaustion.
  for (let page = 1; page <= 20; page++) {
    const links = await archiveLinks(await http.get(`${ROOT}/images/page/${page}/?sort=-release_date`));
    if (!links.length) break;
    const image = await inspect(links); if (image) return image;
  }
  throw new SourceError('No unseen eligible image within bounded archive search');
}
