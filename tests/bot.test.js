import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const root = new URL('../',import.meta.url);
let mf,db,real;
const channel = '123456789012345678';
const env = {DELIVERY_ENABLED:'true',DISCORD_CHANNEL_ID:channel,DISCORD_BOT_TOKEN:'mock-token'};
const feed = ids => `<rss><channel>${ids.map(id=>`<item><title>Webb clean image</title><link>https://esawebb.org/images/${id}/</link><pubDate>Thu, 08 Oct 2026 20:00:00 +0200</pubDate></item>`).join('')}</channel></rss>`;
const detail = (id='weic2621d',extra='') => `<meta property="og:image:secure_url" content="https://cdn.esawebb.org/archives/images/screen/${id}.jpg"><div class="left-column"><h1>Webb nebula (NIRCam image)</h1><p>NASA/ESA/CSA James Webb Space Telescope shows a nebula. &amp; stars.</p><strong>Credit:</strong><div class="credit"><p>NASA, ESA, CSA, <a href="https://stsci.edu/">STScI</a>, A. Example</p></div>${extra}</div><table><tr><th>Type:</th><td>Observation</td></tr><tr><th>Release date:</th><td>8 October 2026, 20:00</td></tr><tr><th>Category:</th><td>NIRCam Galaxies</td></tr></table>`;
const pages = ids => Object.fromEntries([['https://esawebb.org/images/feed/',feed(ids)],...ids.map(id=>[`https://esawebb.org/images/${id}/`,detail(id)])]);
async function call(x) { return (await mf.dispatchFetch('https://local.test/',{method:'POST',body:JSON.stringify(x)})).json(); }
before(async()=>{
  const modules = ['tests/harness.js','src/source.js','src/state.js','src/discord.js','src/worker.js','src/setup.js'].map(path=>({type:'ESModule',path:fileURLToPath(new URL(path,root))}));
  mf = new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:fileURLToPath(root),compatibilityDate:'2026-10-01',d1Databases:['DB']}));
  db = await mf.getD1Database('DB');
  await db.exec((await readFile(new URL('migrations/0001_initial.sql',root),'utf8')).replace(/\s+/g,' '));
  real = await readFile(new URL('tests/fixtures/detail.html',root),'utf8');
});
after(async()=>{await mf?.dispose();});
beforeEach(async()=>{await db.batch([db.prepare('DELETE FROM deliveries'),db.prepare('DELETE FROM meta'),db.prepare('DELETE FROM rejected_images')]);});

test('real official RSS and gallery fixtures yield canonical image links',async()=>{
  const f = await call({op:'feed',raw:await readFile(new URL('tests/fixtures/feed.xml',root),'utf8')});
  assert.ok(f.result.includes('https://esawebb.org/images/weic2621d/'));
  const a = await call({op:'archive',raw:await readFile(new URL('tests/fixtures/archive.html',root),'utf8')});
  assert.ok(a.result.length >= 4);
});
test('real official metadata preserves full credit, original date, caption and image',async()=>{
  const x = await call({op:'detail',url:'https://esawebb.org/images/weic2621d/',raw:real});
  assert.equal(x.result?.released,'2026-10-08',JSON.stringify(x));
  assert.equal(x.result.credit,'NASA, ESA, CSA, STScI, T. Nanayakkara (USYD). Image Processing: J. DePasquale (STScI)');
  assert.match(x.result.caption,/host galaxy/);
  assert.equal(x.result.family,'weic2621');
});
test('rejects illustrations, spectra, missing credit, non-Webb images and rights exceptions',async()=>{
  const variants = [detail().replace('Observation','Illustration'),detail().replace('Webb nebula (NIRCam image)','Webb spectrum'),
    detail().replace('class="credit"','class="missing"'),detail().replaceAll('Webb','Hubble'),detail('weic2621d','<p>All rights reserved; permission required.</p>')];
  for (const raw of variants) {const x=await call({op:'detail',url:'https://esawebb.org/images/weic2621d/',raw}); assert.equal(x.errorType,'Ineligible',JSON.stringify(x));}
});
test('preserves active credit links, no mention spam and truthful archive label',async()=>{
  const {result:image}=await call({op:'detail',url:'https://esawebb.org/images/weic2621d/',raw:detail()});
  assert.match(image.creditMarkdown,/\[STScI\]\(https:\/\/stsci.edu\/\)/);
  const {result:p}=await call({op:'payload',image});
  assert.match(p.content,/Archive selection · originally released 2026-10-08/);
  assert.deepEqual(p.allowed_mentions.parse,[]); assert.equal(p.enforce_nonce,true); assert.ok(p.nonce.length<=25);
});
test('civil-time scheduling follows New York DST and skips old/backlog slots',async()=>{
  for(const [now,want] of [['2026-07-01T15:59:00Z',null],['2026-07-01T16:00:00Z','2026-07-01'],['2026-12-01T17:00:00Z','2026-12-01'],['2026-12-01T23:00:00Z',null],['2026-11-01T17:00:00Z','2026-11-01'],['2026-03-08T16:00:00Z','2026-03-08']]) {
    assert.equal((await call({op:'date',now})).result,want);
  }
  assert.equal((await call({op:'date',now:'2026-10-18T12:30:00Z',env:{TIMEZONE:'UTC',DAILY_TIME:'12:30'}})).result,'2026-10-18');
});
test('disabled worker, outside window and public HTTP cannot deliver',async()=>{
  assert.equal((await call({op:'run',env:{DELIVERY_ENABLED:'false'},now:'2026-10-18T16:00:00Z'})).result.status,'disabled');
  const x=await call({op:'run',env,now:'2026-10-18T14:00:00Z'});assert.equal(x.result.status,'outside-window');assert.equal(x.calls.length,0);
  assert.equal((await call({op:'public'})).result,404);
});
test('posts once per date, persists restart history and avoids release variants',async()=>{
  const x=await call({op:'run',env,now:'2026-10-18T16:00:00Z',pages:pages(['weic2621d','weic2620a'])});
  assert.equal(x.result?.status,'sent',JSON.stringify(x));
  const duplicate=await call({op:'run',env,now:'2026-10-18T17:00:00Z'});assert.equal(duplicate.result.status,'already-handled');assert.equal(duplicate.calls.length,0);
  const next=await call({op:'run',env,now:'2026-10-19T16:00:00Z',pages:pages(['weic2621a','weic2620a'])});
  assert.equal(next.result.image,'weic2620a',JSON.stringify(next));
  assert.equal((await db.prepare("SELECT count(*) AS n FROM deliveries WHERE status='sent'").first()).n,2);
});
test('concurrent scheduled invocations reserve one daily delivery',async()=>{
  const results=await Promise.all([1,2].map(()=>call({op:'run',env,now:'2026-10-18T16:00:00Z',pages:pages(['weic2621d'])})));
  assert.equal(results.flatMap(x=>x.calls).filter(x=>x.method==='POST').length,1);
});
test('falls back to archive after used feed releases without repeating variants',async()=>{
  await call({op:'run',env,now:'2026-10-18T16:00:00Z',pages:pages(['weic2621d'])});
  const x=await call({op:'run',env,now:'2026-10-19T16:00:00Z',pages:{...pages(['weic2621a']),
    'https://esawebb.org/images/page/1/?sort=-release_date':'<div id="jGallery"><a href="/images/weic2620a/">Older Webb image</a></div>',
    'https://esawebb.org/images/weic2620a/':detail('weic2620a')}});
  assert.equal(x.result?.image,'weic2620a',JSON.stringify(x));
});
test('stores ineligible metadata temporarily so chart-heavy releases cannot stall rotation forever',async()=>{
  const ids=['weic2621b','weic2620a'];
  await call({op:'run',env,now:'2026-10-18T16:00:00Z',pages:{...pages(ids),'https://esawebb.org/images/weic2621b/':detail('weic2621b').replace('Webb nebula (NIRCam image)','Webb spectrum')}});
  assert.equal((await db.prepare('SELECT image_id FROM rejected_images').first()).image_id,'weic2621b');
  const x=await call({op:'run',env,now:'2026-10-19T16:00:00Z',pages:pages(['weic2621b','weic2619a'])});
  assert.equal(x.result?.image,'weic2619a',JSON.stringify(x));
  assert.ok(!x.calls.some(c=>c.url==='https://esawebb.org/images/weic2621b/'));
});
test('uncertain network outcome persists and blocks all subsequent delivery',async()=>{
  const x=await call({op:'run',env,now:'2026-10-18T16:00:00Z',pages:pages(['weic2621d']),responses:[{throws:true}]});
  assert.equal(x.errorType,'UncertainDelivery');
  assert.equal((await db.prepare('SELECT status FROM deliveries').first()).status,'uncertain');
  const y=await call({op:'run',env,now:'2026-10-19T16:00:00Z'});assert.match(y.error,/Unresolved/);assert.equal(y.calls.length,0);
});
test('crash after durable reservation blocks delivery and state is pinned to channel',async()=>{
  await db.prepare("INSERT INTO deliveries(day,channel,status,family) VALUES ('2026-10-17',?,'pending','weic2620')").bind(channel).run();
  assert.match((await call({op:'run',env,now:'2026-10-18T16:00:00Z'})).error,/Unresolved/);
  await db.prepare('DELETE FROM deliveries').run();
  assert.match((await call({op:'run',env:{...env,DISCORD_CHANNEL_ID:'999999999999999999'},now:'2026-10-18T16:00:00Z'})).error,/another channel/);
});
test('source failure skips the day and never posts or repeats source fetches',async()=>{
  const x=await call({op:'run',env,now:'2026-10-18T16:00:00Z'});assert.equal(x.result.status,'source-skipped');assert.ok(x.calls.every(c=>c.method!=='POST'));
  const y=await call({op:'run',env,now:'2026-10-18T17:00:00Z'});assert.equal(y.calls.length,0);
});
test('Discord 429 honors retry_after with bounded attempts and stable nonce',async()=>{
  const x=await call({op:'send',body:{nonce:'same',enforce_nonce:true},responses:[{status:429,body:'{"retry_after":0.01,"global":true}'},{status:200,body:'{"id":"12345"}'}]});
  assert.equal(x.result,'12345');assert.equal(x.calls.length,2);assert.equal(x.pauses[0],110);assert.equal(x.calls[0].body.nonce,x.calls[1].body.nonce);
  const y=await call({op:'send',responses:Array(3).fill({status:429,body:'{"retry_after":0}'})});assert.equal(y.calls.length,3);assert.match(y.error,/budget/);
  const z=await call({op:'send',responses:[{status:429,body:'{"retry_after":3600}'}]});assert.equal(z.calls.length,1);
});
test('auth errors are definitive; 5xx/redirects/invalid success are uncertain; no POST retry',async()=>{
  for(const [status,body,type] of [[401,'','DeliveryError'],[403,'','DeliveryError'],[500,'','UncertainDelivery'],[302,'','UncertainDelivery'],[200,'{}','UncertainDelivery']]) {
    const x=await call({op:'send',responses:[{status,body}]});assert.equal(x.errorType,type);assert.equal(x.calls.length,1);assert.equal(x.calls[0].redirect,'manual');
  }
});
test('source network retries are bounded and off-domain redirects refused',async()=>{
  const x=await call({op:'get',url:'https://esawebb.org/images/feed/',responses:Array(3).fill({throws:true})});assert.equal(x.calls.length,3);assert.match(x.error,/3 attempts/);
  const y=await call({op:'get',url:'https://esawebb.org/images/feed/',responses:[{status:302,headers:{location:'https://evil.test/'}}]});assert.equal(y.calls.length,1);assert.match(y.error,/Unsafe/);
});
test('source fetch does not bind the native function to its client instance',async()=>{
  const x=await call({op:'get-receiver'});assert.equal(x.result,'native-fetch-compatible',JSON.stringify(x));
});
const verificationEnv={...env,DELIVERY_ENABLED:'false',EXPECTED_BOT_ID:'333333333333333333',EXPECTED_GUILD_NAME:'Fixture Server',EXPECTED_CHANNEL_NAME:'general',SETUP_CHECK_ID:'fixture-check-01'};
const verificationResponses=()=>[
  {status:200,body:JSON.stringify({id:'333333333333333333',bot:true,username:'Daily Webb'})},
  {status:200,body:JSON.stringify({id:channel,type:0,name:'general',guild_id:'444444444444444444'})},
  {status:200,body:JSON.stringify({id:'444444444444444444',name:'Fixture Server'})}
];
test('secure destination check uses GET only and verifies bot, server and channel',async()=>{
  const x=await call({op:'verify',env:verificationEnv,responses:verificationResponses()});
  assert.equal(x.result?.status,'destination-verified',JSON.stringify(x));
  assert.equal(x.result.channelName,'general');assert.ok(x.calls.every(c=>c.method==='GET'));
  assert.ok(!JSON.stringify(x.result).includes('mock-token'));
});
test('destination check rejects mismatched identities, channels and auth errors',async()=>{
  const wrongBot=await call({op:'verify',env:{...verificationEnv,EXPECTED_BOT_ID:'555555555555555555'},responses:verificationResponses()});
  assert.match(wrongBot.error,/Bot identity/);
  const wrongServer=await call({op:'verify',env:{...verificationEnv,EXPECTED_GUILD_NAME:'Different Server'},responses:verificationResponses()});
  assert.match(wrongServer.error,/Server name/);
  const unauthorized=await call({op:'verify',env:verificationEnv,responses:[{status:401}]});assert.match(unauthorized.error,/401/);
  const missingAccess=await call({op:'verify',env:verificationEnv,responses:[verificationResponses()[0],{status:403,body:'{"code":50001,"message":"Missing Access"}'}]});
  assert.match(missingAccess.error,/channel access check HTTP 403 \(code 50001\)/);
});
test('setup checks are cached, cannot send and require delivery disabled',async()=>{
  const x=await call({op:'verify-once',env:verificationEnv,responses:verificationResponses()});assert.equal(x.result.status,'destination-verified');
  const cached=await call({op:'verify-once',env:verificationEnv});assert.equal(cached.result.status,'destination-verified');assert.equal(cached.calls.length,0);
  const enabled=await call({op:'verify-once',env:{...verificationEnv,DELIVERY_ENABLED:'true'}});assert.match(enabled.error,/disabled/);assert.equal(enabled.calls.length,0);
});
test('single-date test cannot continue sending on later dates',async()=>{
  const x=await call({op:'run',env:{...env,SINGLE_POST_DATE:'2026-10-18'},now:'2026-10-18T16:00:00Z',pages:pages(['weic2621d'])});assert.equal(x.result.status,'sent');
  const y=await call({op:'run',env:{...env,SINGLE_POST_DATE:'2026-10-18'},now:'2026-10-19T16:00:00Z',pages:pages(['weic2620a'])});assert.equal(y.result.status,'outside-single-post-date');assert.equal(y.calls.length,0);
});
