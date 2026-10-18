// Local test/preview entry point only; never bundled into the production Worker.
import {feedLinks,archiveLinks,parseDetail,SourceHTTP} from '../src/source.js';
import {run,config,dueDay} from '../src/worker.js';
import worker from '../src/worker.js';
import {sendDiscord,makePayload} from '../src/discord.js';
import {verifyDestination,verifyOnce} from '../src/setup.js';

export default {async fetch(request, env) {
  const x = await request.json(), calls = [], pauses = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({url,method:init.method || 'GET',body:init.body ? JSON.parse(init.body) : null,redirect:init.redirect});
    const response = x.responses?.shift();
    if (response?.throws) throw new Error('simulated timeout');
    if (response) return new Response(response.body ?? '',{status:response.status,headers:response.headers});
    if (String(url).startsWith('https://discord.com/')) return Response.json({id:'123456789012345678'});
    const body = x.pages?.[url];
    if (body === undefined) throw new Error(`Unmocked source ${url}`);
    return new Response(body);
  };
  try {
    let result;
    if (x.op === 'feed') result = feedLinks(x.raw);
    if (x.op === 'archive') result = await archiveLinks(x.raw);
    if (x.op === 'detail') result = await parseDetail(x.url,x.raw);
    if (x.op === 'date') result = dueDay(new Date(x.now),config(x.env || {}));
    if (x.op === 'public') result = (await worker.fetch(new Request('https://example.test/post'))).status;
    if (x.op === 'send') result = await sendDiscord('123456789012345678','mock-token',x.body || {},fakeFetch,async ms=>pauses.push(ms));
    if (x.op === 'get') result = await new SourceHTTP(fakeFetch,async ms=>pauses.push(ms)).get(x.url);
    if (x.op === 'get-receiver') result = await new SourceHTTP(function(){
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return new Response('native-fetch-compatible');
    },async()=>{}).get('https://esawebb.org/images/feed/');
    if (x.op === 'verify') result = await verifyDestination({...env,...x.env},fakeFetch);
    if (x.op === 'verify-once') result = await verifyOnce({...env,...x.env},fakeFetch);
    if (x.op === 'payload') result = await makePayload(x.image,'2026-10-18','123456789012345678');
    if (x.op === 'run') result = await run({...env,...x.env},{now:new Date(x.now),http:{get:async url=>{
      calls.push({url,method:'GET'}); if(x.pages?.[url] === undefined) throw new Error('Unmocked source'); return x.pages[url];
    }},fetcher:fakeFetch,pause:async ms=>pauses.push(ms)});
    return Response.json({result,calls,pauses});
  } catch(e) {return Response.json({error:e.message,errorType:e.constructor.name,calls,pauses});}
}};
