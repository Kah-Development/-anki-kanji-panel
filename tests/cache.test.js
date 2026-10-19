const {test} = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const {createCacheStore,lookup,addComponents,defaults} = require('../kanji-panel');
const reply = data=>({ok:true,json:async()=>data});
function environment(){
  const saved=new Map();let time=1000000000000;
  return {saved,crypto:webcrypto,now:()=>time,advance:ms=>{time+=ms;},localStorage:{getItem:n=>saved.get(n)||null,setItem:(n,v)=>saved.set(n,v)}};
}
const wk = char=>({characters:char,meanings:[{meaning:'example'}],readings:[],component_subject_ids:[1]});
const api = char=>({kanji:char,meanings:['example'],on_readings:[],kun_readings:[]});
const svg='<g kvg:element="猫"><g kvg:element="木" kvg:radical="general"/></g>';
test('WaniKani repeated characters skip requests and mixed sentences request only missing characters',async()=>{
  const cache=await createCacheStore(environment()).open('TEST');
  const config={...defaults,token:'TEST',_cache:cache};let calls=0;
  const fetcher=async url=>{calls++;const chars=new URL(url).searchParams.get('slugs').split(',');return reply({data:chars.map(c=>({object:'kanji',data:wk(c)})),pages:{next_url:null}});};
  await lookup(['学','校'],config,fetcher);assert.equal(calls,1);
  await lookup(['学','校'],config,()=>assert.fail('Cached kanji requested'));
  const results=await lookup(['学','生'],config,async url=>{assert.equal(new URL(url).searchParams.get('slugs'),'生');return fetcher(url);});
  assert.deepEqual(results.results.map(r=>r.char),['学','生']);assert.equal(calls,2);
});
test('WaniKani radicals cache per subject ID across different kanji',async()=>{
  const cache=await createCacheStore(environment()).open('TEST'),config={...defaults,token:'TEST',_cache:cache};
  const fetcher=async()=>reply({data:[{object:'radical',id:1,data:{characters:'木',meanings:[{primary:true,meaning:'Tree'}]}}],pages:{next_url:null}});
  await addComponents([{char:'林',wk:wk('林')}],config,fetcher);
  const results=[{char:'森',wk:wk('森')}];await addComponents(results,config,()=>assert.fail('Cached radical requested'));
  assert.equal(results[0].wkRadicals[0].name,'Tree');
});
test('kanjiapi and parsed KanjiVG components persist across cache store reloads',async()=>{
  const env=environment(),config={...defaults,_cache:await createCacheStore(env).open('')};
  const first=await lookup(['猫'],config,async()=>reply(api('猫')));
  await addComponents(first.results,config,async()=>({ok:true,text:async()=>svg}));
  const reloaded={...defaults,_cache:await createCacheStore(env).open('')};
  const second=await lookup(['猫'],reloaded,()=>assert.fail('Cached API requested'));
  await addComponents(second.results,reloaded,()=>assert.fail('Cached SVG requested'));
  assert.deepEqual(second.results[0].parts,{radicals:['木'],components:['木']});
});
test('30-day expiry is based on fetch time, not the most recent read',async()=>{
  const env=environment(),cache=await createCacheStore(env).open('');cache.set('api','猫',api('猫'));
  env.advance(29*86400000);assert.ok(cache.get('api','猫'));env.advance(86400000);assert.equal(cache.get('api','猫'),undefined);
});
test('same key reuses persisted WK data, changed or removed key clears WK while retaining public data',async()=>{
  const env=environment();let store=createCacheStore(env),cache=await store.open('SECRET');
  cache.set('wk:kanji','猫',wk('猫'));cache.set('wk:radical',1,{name:'Tree'});cache.set('api','犬',api('犬'));cache.flush();
  assert.ok(!env.saved.get('akp.dictionary.v1').includes('SECRET'));
  store=createCacheStore(env);cache=await store.open('SECRET');assert.ok(cache.get('wk:kanji','猫'));
  const next=await store.open('OTHER');assert.equal(next.get('wk:kanji','猫'),undefined);assert.ok(next.get('api','犬'));
  cache.set('wk:kanji','猫',wk('猫'));assert.equal(next.get('wk:kanji','猫'),undefined);
  next.set('wk:radical',1,{name:'Tree'});assert.equal((await store.open('')).get('wk:radical',1),undefined);
});
test('clearing prevents in-flight responses from repopulating memory or persistent data',async()=>{
  const env=environment(),store=createCacheStore(env),old=await store.open('TEST');
  old.set('api','猫',api('猫'));assert.equal(old.clear(),true);
  old.set('api','猫',api('猫'));old.flush();
  const fresh=await store.open('TEST');assert.equal(fresh.get('api','猫'),undefined);
  fresh.set('api','犬',api('犬'));assert.ok(fresh.get('api','犬'));
});
test('temporary failures and invalid responses are retried, not cached',async()=>{
  const config={...defaults,_cache:await createCacheStore(environment()).open('')};
  await lookup(['猫'],config,async()=>({ok:false,status:500}));
  await lookup(['猫'],config,async()=>reply({bad:true}));
  let requests=0;const result=await lookup(['猫'],config,async()=>{requests++;return reply(api('猫'));});
  assert.equal(requests,1);assert.ok(result.results[0].api);
  await addComponents(result.results,config,async()=>({ok:false,status:404}));
  await addComponents(result.results,config,async()=>({ok:true,text:async()=>svg}));assert.ok(result.results[0].parts);
});
test('malformed storage, denied storage, and quota errors retain working memory cache',async()=>{
  for(const mode of ['corrupt','denied','quota']){
    const env=environment();env.saved.set('akp.dictionary.v1','not-json');
    if(mode==='denied')env.localStorage.getItem=()=>{throw Error('Denied');};
    if(mode!=='corrupt')env.localStorage.setItem=()=>{throw Error('Quota');};
    const cache=await createCacheStore(env).open('');cache.set('api','猫',api('猫'));cache.flush();assert.ok(cache.get('api','猫'));
    if(mode!=='corrupt')assert.match(cache.status(),/memory only/);
  }
});
test('cache bounds entry count and serialized size, evicting least recently used entries',async()=>{
  const env=environment(),cache=await createCacheStore(env).open('');
  for(let n=0;n<1500;n++)cache.set('api',n,{meanings:['value']});
  cache.get('api',0);cache.set('api',1500,{meanings:['value']});assert.equal(cache.get('api',1),undefined);assert.ok(cache.get('api',0));
  for(let n=0;n<40;n++)cache.set('vg',n,{components:['x'.repeat(100000)]});cache.flush();
  const text=env.saved.get('akp.dictionary.v1');assert.ok(text.length<=2000000);assert.ok(JSON.parse(text).entries.length<=1500);
});
test('without crypto, WaniKani cache stays in memory and never stores the raw token',async()=>{
  const env=environment();delete env.crypto;
  const cache=await createCacheStore(env).open('SECRET');cache.set('wk:kanji','猫',wk('猫'));cache.set('api','犬',api('犬'));cache.flush();
  assert.ok(cache.get('wk:kanji','猫'));const text=env.saved.get('akp.dictionary.v1');assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('wk:kanji'));
});
