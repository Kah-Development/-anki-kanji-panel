const {test} = require('node:test');
const assert = require('node:assert/strict');
const {explainSentence,defaults,mountGemini} = require('../kanji-panel');
const settings = {...defaults.gemini,timeout:50};
const response = text => ({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'private thought',thought:true},{text}]}}]})});
test('Gemini sends only the sentence and teaching prompt to Google with a header key',async()=>{
  const result=await explainSentence('猫が好きです。',settings,' TEST ',async(url,options)=>{
    assert.equal(new URL(url).origin,'https://generativelanguage.googleapis.com');
    assert.ok(!url.includes('TEST'));assert.equal(options.headers['x-goog-api-key'],'TEST');
    assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);assert.match(body.contents[0].parts[0].text,/N3/);
    assert.match(body.contents[0].parts[0].text,/猫が好きです。/);
    assert.ok(!options.body.includes('TEST'));return response('<script>example</script>');
  });
  assert.equal(result,'<script>example</script>');
});
test('empty key, empty sentence, and invalid model make no requests',async()=>{
  const fetcher=()=>assert.fail('Unexpected request');
  await assert.rejects(explainSentence('猫',settings,'',fetcher),/key/);
  await assert.rejects(explainSentence(' ',settings,'TEST',fetcher),/empty/);
  await assert.rejects(explainSentence('猫',{...settings,model:'https://example.com'},'TEST',fetcher),/model/);
});
test('quota, auth, missing model, network, timeout, blocked and truncated responses are actionable',async()=>{
  for(const [status,pattern] of [[429,/limit/],[403,/key/],[404,/model/]])
    await assert.rejects(explainSentence('猫',settings,'TEST',async()=>({ok:false,status})),pattern);
  await assert.rejects(explainSentence('猫',settings,'TEST',async()=>{throw Error('TEST');}),/Could not reach/);
  await assert.rejects(explainSentence('猫',{...settings,timeout:2},'TEST',()=>new Promise(()=>{})),/timed out/);
  await assert.rejects(explainSentence('猫',settings,'TEST',async()=>({ok:true,json:async()=>({promptFeedback:{blockReason:'SAFETY'}})})),/no explanation/);
  await assert.rejects(explainSentence('猫',settings,'TEST',async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]})})),/incomplete/);
});
// Small DOM substitute exercises event handling without a browser or real API key.
class Element {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.value='';this.textContent='';}
  appendChild(el){this.children.push(el);return el;}
  append(...els){els.forEach(el=>this.appendChild(el));}
  setAttribute(){}
}
const doc={createElement:tag=>new Element(tag,doc),createTextNode:text=>({textContent:text})};
function all(el){return [el,...(el.children||[]).flatMap(all)];}
test('UI runs only on tap, blocks double taps, caches, regenerates, and forgets saved keys',async()=>{
  let calls=0,resolve;const saved=new Map();
  global.localStorage={getItem:n=>saved.get(n)||null,setItem:(n,v)=>saved.set(n,v),removeItem:n=>saved.delete(n)};
  global.fetch=async()=>{calls++;return new Promise(r=>{resolve=r;});};
  const target=new Element('div',doc);mountGemini(target,'犬がいます。',defaults,()=>true);
  const els=all(target),buttons=els.filter(x=>x.tagName==='button'),inputs=els.filter(x=>x.tagName==='input');
  const button=t=>buttons.find(x=>x.textContent===t);
  assert.equal(calls,0);await button('Explain sentence').onclick();assert.equal(calls,0);
  inputs[0].value='TEST';inputs[2].checked=true;button('Save settings').onclick();
  assert.equal(saved.get('akp.gemini.key'),'TEST');
  const first=button('Explain sentence').onclick();await button('Explain sentence').onclick();assert.equal(calls,1);
  resolve(response('<img src=x onerror=alert(1)>'));await first;
  assert.equal(els.find(x=>x.className==='akp-explanation').textContent,'<img src=x onerror=alert(1)>');
  await button('Explain sentence').onclick();assert.equal(calls,1);
  const second=button('Regenerate').onclick();assert.equal(calls,2);resolve(response('new'));await second;
  button('Forget key').onclick();assert.equal(inputs[0].value,'');assert.equal(saved.has('akp.gemini.key'),false);
});
test('a result for a previous card is never displayed; unavailable storage does not break the UI',async()=>{
  let active=true,resolve;
  global.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
  global.fetch=async()=>new Promise(r=>{resolve=r;});
  const target=new Element('div',doc);mountGemini(target,'鳥がいます。',defaults,()=>active);
  const els=all(target);els.find(x=>x.tagName==='input').value='TEST';
  const pending=els.find(x=>x.textContent==='Explain sentence').onclick();active=false;
  resolve(response('stale'));await pending;
  assert.equal(els.find(x=>x.className==='akp-explanation').textContent,'');
});
