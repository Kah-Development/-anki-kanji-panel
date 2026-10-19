const {test} = require('node:test');
const assert = require('node:assert/strict');
const {extract,lookup,defaults} = require('../kanji-panel.js');
const reply = data => ({ok:true,json:async()=>data});
test('full sentence: unique kanji in order; skips punctuation, kana, repetition mark',()=>{
  assert.deepEqual(extract('猫、犬。猫と学校へ。時々𠮷'),['猫','犬','学','校','時','𠮷']);
});
test('WK hit, fallback miss, failure: every kanji keeps its result and order',async()=>{
  const calls=[];
  const out=await lookup(['猫','犬','𠮷'],{...defaults,token:'TEST'},async url=>{
    calls.push(url);
    if(url.includes('wanikani')) return reply({data:[{object:'kanji',data:{characters:'猫'}}],pages:{next_url:null}});
    if(decodeURIComponent(url).endsWith('犬')) return reply({kanji:'犬',meanings:['dog'],on_readings:['ケン'],kun_readings:['いぬ']});
    throw Error('offline');
  });
  assert.equal(calls.length,3); assert.ok(out.results[0].wk); assert.equal(out.results[1].api.kun_readings[0],'いぬ'); assert.ok(out.results[2].error);
});
test('WK unauthorized still returns dictionary results',async()=>{
  const out=await lookup(['猫'],{...defaults,token:'TEST'},async url=>url.includes('wanikani')?{ok:false,status:401}:reply({kanji:'猫',meanings:['cat']}));
  assert.match(out.warning,/401/); assert.ok(out.results[0].api);
});
test('empty token makes no WaniKani request',async()=>{
  await lookup(['猫'],defaults,async url=>{assert.ok(url.startsWith('https://kanjiapi.dev/'));return reply({kanji:'猫',meanings:['cat']});});
});
test('timeout produces visible per-kanji error',async()=>{
  const out=await lookup(['猫'],{...defaults,timeout:5},()=>new Promise(()=>{})); assert.match(out.results[0].error,/timed out/);
});
test('pagination is followed',async()=>{
  let n=0;const out=await lookup(['猫'],{...defaults,token:'TEST'},async()=>reply(++n===1?{data:[],pages:{next_url:'https://api.wanikani.com/v2/subjects?page_after_id=1'}}:{data:[{object:'kanji',data:{characters:'猫'}}],pages:{next_url:null}}));
  assert.equal(n,2);assert.ok(out.results[0].wk);
});
const {parseComponents,addComponents} = require('../kanji-panel.js');
const componentSvg = '<svg><g kvg:element="猫"><g kvg:element="⺨" kvg:radical="general"></g><g kvg:element="苗"><g kvg:element="艹"></g><g kvg:element="田"></g></g></g></svg>';
test('radical and leaf components are distinct; ignores comments and duplicate parts',()=>{
  assert.deepEqual(parseComponents('<!-- <g kvg:element="wrong"> -->'+componentSvg,'猫'),{radicals:['⺨'],components:['⺨','艹','田']});
  assert.deepEqual(parseComponents('<g kvg:element="林"><g kvg:element="木"/><g kvg:element="木"/></g>','林').components,['木']);
  assert.throws(()=>parseComponents('<html>Not found</html>','猫'));
});
test('component requests support no-token operation and preserve dictionary results on failure',async()=>{
  const results=[{char:'猫',api:{meanings:['cat']}},{char:'𠮷',error:'No dictionary entry'}];
  await addComponents(results,defaults,async url=>{
    assert.ok(url.startsWith('https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/'));
    if(url.endsWith('0732b.svg')) return {ok:true,text:async()=>componentSvg};
    assert.ok(url.endsWith('20bb7.svg'));return {ok:false,status:404};
  });
  assert.deepEqual(results[0].parts.components,['⺨','艹','田']);
  assert.equal(results[0].api.meanings[0],'cat');
  assert.ok(results[1].partsError);
});
test('disabled radicals makes no extra requests',async()=>{
  await addComponents([{char:'猫'}],{...defaults,show:{radicals:false}},()=>{throw Error('Unexpected request');});
});
test('WaniKani names use deduplicated IDs, follow pagination, preserve component order and name image-only radicals',async()=>{
  const results=[{char:'猫',wk:{component_subject_ids:[2,1]}},{char:'犬',wk:{component_subject_ids:[1]}}];
  const calls=[];
  await addComponents(results,{...defaults,token:'TEST'},async(url,options)=>{
    calls.push(url);assert.equal(options.headers.Authorization,'Bearer TEST');
    if(calls.length===1){assert.equal(new URL(url).searchParams.get('ids'),'2,1');
      return reply({data:[{id:1,object:'radical',data:{characters:'犬',meanings:[{meaning:'Dog',primary:false},{meaning:'Animal',primary:true}]}}],pages:{next_url:'https://api.wanikani.com/v2/subjects?page_after_id=1'}});}
    return reply({data:[{id:2,object:'radical',data:{characters:null,meanings:[{meaning:'Special',primary:true}]}}],pages:{next_url:null}});
  });
  assert.equal(calls.length,2);
  assert.deepEqual(results[0].wkRadicals,[{name:'Special',character:''},{name:'Animal',character:'犬'}]);
  assert.equal(results[1].wkRadicals[0].name,'Animal');
});
test('failed or incomplete WaniKani radical lookup falls back without sending token to CDN',async()=>{
  for(const fail of [true,false]){
    const results=[{char:'猫',wk:{component_subject_ids:[1,2]}}];
    await addComponents(results,{...defaults,token:'TEST'},async(url,options)=>{
      if(url.startsWith('https://api.wanikani.com/'))return fail?{ok:false,status:401}:reply({data:[],pages:{next_url:null}});
      assert.equal(options.headers,undefined);return {ok:true,text:async()=>componentSvg};
    });
    assert.ok(results[0].parts);assert.equal(results[0].wkRadicals,undefined);
  }
});
test('untrusted radical pagination does not receive the token',async()=>{
  const results=[{char:'猫',wk:{component_subject_ids:[1]}}];
  await addComponents(results,{...defaults,token:'TEST'},async(url,options)=>{
    if(url.startsWith('https://api.wanikani.com/'))return reply({data:[],pages:{next_url:'https://example.com/steal'}});
    assert.ok(url.startsWith('https://cdn.jsdelivr.net/'));assert.equal(options.headers,undefined);
    return {ok:true,text:async()=>componentSvg};
  });
  assert.ok(results[0].parts);
});
