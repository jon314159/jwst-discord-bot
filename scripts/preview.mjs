// Read-only preview. This script never loads a Discord token or calls Discord.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {FEED,SourceHTTP,feedLinks} from '../src/source.js';
const root = new URL('../',import.meta.url);
const modules = ['tests/harness.js','src/source.js','src/state.js','src/discord.js','src/worker.js','src/setup.js'].map(path=>({type:'ESModule',path:fileURLToPath(new URL(path,root))}));
const mf = new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:fileURLToPath(root),compatibilityDate:'2026-10-01'}));
const call = async x => (await mf.dispatchFetch('https://preview.local/',{method:'POST',body:JSON.stringify(x)})).json();
try {
  let image;
  if (process.argv.includes('--live')) {
    const http = new SourceHTTP();
    const links = feedLinks(await http.get(FEED));
    for (const url of links.slice(0,6)) {
      const x = await call({op:'detail',url,raw:await http.get(url)});
      if (x.result) {image = x.result; break;}
    }
    if (!image) throw new Error('No eligible image in first six current feed entries');
  } else {
    const x = await call({op:'detail',url:'https://esawebb.org/images/weic2621d/',raw:await readFile(new URL('tests/fixtures/detail.html',root),'utf8')});
    if (!x.result) throw new Error(x.error);
    image = x.result;
  }
  const {makePayload} = await import('../src/discord.js');
  const payload = await makePayload(image,new Date().toISOString().slice(0,10),'preview');
  console.log(JSON.stringify({mode:process.argv.includes('--live')?'live-read-only':'official-fixture',source:image.sourceUrl,payload},null,2));
} finally {await mf.dispose();}
