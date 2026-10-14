import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'classroom-backend-'));
await build({entryPoints:[resolve('worker/app.ts'),resolve('worker/storage.ts'),resolve('worker/index.ts')],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
const {handleApi}=await import(pathToFileURL(join(dir,'app.mjs')).href);
const {SupabaseStore,DurableStore,MAX_SNAPSHOT_BYTES}=await import(pathToFileURL(join(dir,'storage.mjs')).href);
const {ClassroomDurableObject}=await import(pathToFileURL(join(dir,'index.mjs')).href);
test.after(()=>rm(dir,{recursive:true,force:true}));

function memoryStorage(values=new Map(),failKey=()=>false) {
  const methods=map=>({
    async get(key){const v=map.get(key);return v===undefined?undefined:structuredClone(v);},
    async put(key,value){if(failKey(key))throw new Error('Injected storage failure');if(value instanceof Uint8Array)assert(value.byteLength<=65536);map.set(key,structuredClone(value));},
    async delete(key){return map.delete(key);},
  });
  return {...methods(values),async transaction(operation){const copy=structuredClone(values);const result=await operation(methods(copy));values.clear();for(const [key,value]of copy)values.set(key,value);return result;}};
}

function fixture(env={APP_MODE:'demo'}) {
  let data;
  const store={async read(){return data&&structuredClone(data);},async write(next){data=structuredClone(next);}};
  const cookies=new Map();
  return {
    get data(){return data;},
    async call(path,method='GET',body,user='teacher',origin='http://localhost') {
      const headers={'Origin':origin};
      if(cookies.has(user))headers.Cookie=cookies.get(user);
      if(method!=='GET')headers['Content-Type']='application/json';
      const response=await handleApi(new Request(`http://localhost${path}`,{method,headers,body:method!=='GET'?JSON.stringify(body??{}):undefined}),{store,env});
      if(response.headers.has('Set-Cookie'))cookies.set(user,response.headers.get('Set-Cookie').split(';')[0]);
      return {status:response.status,body:await response.json(),headers:response.headers};
    },
  };
}
async function setup() {
  const f=fixture();await f.call('/api/login','POST',{role:'teacher'});
  const dashboard=(await f.call('/api/dashboard')).body;
  const lesson=dashboard.lessons[0],cl=dashboard.classes[0];
  const session=(await f.call('/api/sessions','POST',{lessonId:lesson.id,classId:cl.id})).body.session;
  await f.call('/api/login','POST',{role:'student',classCode:'DEMO801',seat:1,code:'DEMO01'},'student');
  return {f,lesson,session};
}

test('student scope, hidden keys, activity gating, deduplication, and snapshot integrity',async()=>{
  const {f,lesson,session}=await setup();
  assert.equal((await f.call('/api/dashboard','GET',null,'student')).status,403);
  const before=(await f.call(`/api/sessions/${session.id}`,'GET',null,'student')).body;
  assert(before.lesson.slides.every(s=>!('notes'in s)&&(!s.activity||!('correct'in s.activity)&&!('explanation'in s.activity))));
  const index=lesson.slides.findIndex(s=>s.activity?.type==='single'),activity=lesson.slides[index].activity;
  const submit={submissionId:'test-submit',activityId:activity.id,value:0};
  assert.equal((await f.call(`/api/sessions/${session.id}/answers`,'POST',submit,'student')).status,409);
  await f.call(`/api/sessions/${session.id}/control`,'POST',{action:'slide',index});
  await f.call(`/api/sessions/${session.id}/control`,'POST',{action:'activity',value:true});
  const accepted=await f.call(`/api/sessions/${session.id}/answers`,'POST',submit,'student');
  assert.equal(accepted.status,200);
  const duplicate=await f.call(`/api/sessions/${session.id}/answers`,'POST',submit,'student');assert.equal(duplicate.body.answer.id,accepted.body.answer.id);
  assert.equal((await f.call(`/api/sessions/${session.id}/answers`,'POST',{...submit,value:1},'student')).status,409);
  assert.equal(f.data.sessions[session.id].answers.length,1);
  const renamed={...lesson,title:'Updated lesson'};await f.call(`/api/lessons/${lesson.id}`,'PUT',{lesson:renamed});
  assert.equal((await f.call(`/api/sessions/${session.id}`)).body.lesson.title,lesson.title);
  await f.call(`/api/sessions/${session.id}/control`,'POST',{action:'results',value:true});
  const after=(await f.call(`/api/sessions/${session.id}`,'GET',null,'student')).body;
  assert.deepEqual(after.lesson.slides[index].activity.correct,activity.correct);assert(after.lesson.slides.every(s=>!('notes'in s)));
  assert.equal(after.aggregate.submitted,1);
});

test('backup excludes secrets; valid restore works; malformed input cannot commit; class reset revokes student session',async()=>{
  const {f,session}=await setup();
  const backup=(await f.call('/api/backup')).body;
  assert(!/codeHash|cloudAccessToken|logins|secret|DEMO01/.test(JSON.stringify(backup)));
  assert.equal((await f.call('/api/restore','POST',{backup})).status,200);
  const snapshot=JSON.stringify(f.data.lessons);
  const malformed={...backup,lessons:[{...backup.lessons[0],title:'Bad'},{}]};
  assert.equal((await f.call('/api/restore','POST',{backup:malformed})).status,400);
  assert.equal(JSON.stringify(f.data.lessons),snapshot);
  const reset=await f.call(`/api/classes/${session.classId}/credentials`,'POST',{seat:1});assert.equal(reset.status,200);
  assert.equal((await f.call('/api/me','GET',null,'student')).body.user,null);
  assert.equal((await f.call('/api/login','POST',{role:'student',classCode:'DEMO801',seat:1,code:'DEMO01'},'student')).status,401);
  assert.equal((await f.call('/api/login','POST',{role:'student',classCode:'DEMO801',seat:1,code:reset.body.credential.code},'student')).status,200);
});

test('CSRF, cloud fail-closed, public demo lock, input caps and logout',async()=>{
  const {f}=await setup();
  assert.equal((await f.call('/api/classes','POST',{name:'x',seats:2},'teacher','https://evil.example')).status,403);
  assert.equal((await f.call('/api/classes','POST',{name:'x',seats:101})).status,400);
  assert.equal((await f.call('/api/classes','POST',{name:'a'.repeat(1_100_000),seats:1})).status,413);
  await f.call('/api/logout','POST');assert.equal((await f.call('/api/dashboard')).status,401);
  const unavailable=fixture({APP_MODE:'supabase'});assert.equal((await unavailable.call('/api/login','POST',{role:'teacher'})).status,503);
  const r=await handleApi(new Request('https://public.example/api/config'),{env:{APP_MODE:'demo'},store:{async read(){},async write(){}}});assert.equal(r.status,503);
});

test('buzz closes atomically under serialized requests and draw avoids repeats',async()=>{
  const {f,session}=await setup();
  await f.call('/api/login','POST',{role:'student',classCode:'DEMO801',seat:2,code:'DEMO02'},'second');
  await f.call(`/api/sessions/${session.id}/control`,'POST',{action:'buzz-open'});
  const first=await f.call(`/api/sessions/${session.id}/buzz`,'POST',{submissionId:'buzz-first'},'student');
  const second=await f.call(`/api/sessions/${session.id}/buzz`,'POST',{submissionId:'buzz-second'},'second');
  assert.deepEqual(first.body.winner,second.body.winner);assert.equal(first.body.winner.seat,1);
  const selected=[];for(let i=0;i<40;i++)selected.push((await f.call(`/api/sessions/${session.id}/control`,'POST',{action:'draw'})).body.session.drawnSeat);
  assert.equal(new Set(selected).size,40);
});

test('AI mock is explicit and sensitive activity cannot reach provider',async()=>{
  const {f,lesson,session}=await setup();
  const mock=await f.call('/api/ai','POST',{task:'lesson-review',lessonId:lesson.id});assert.equal(mock.body.mode,'mock');assert.match(mock.body.text,/未呼叫 AI/);
  const restricted=lesson.slides.find(s=>s.activity?.aiAllowed===false).activity;
  assert.equal((await f.call('/api/ai','POST',{task:'response-summary',sessionId:session.id,activityId:restricted.id})).status,403);
  const short=lesson.slides.find(s=>s.activity?.type==='short').activity;
  assert.equal((await f.call('/api/ai','POST',{task:'response-summary',sessionId:session.id,activityId:short.id})).body.mode,'mock');
});

test('Supabase adapter honors revisions, secret apikey semantics and CAS conflicts',async()=>{
  const original=globalThis.fetch;const calls=[];
  try {
    let nextRevision=8;
    globalThis.fetch=async(url,options)=>{
      calls.push({url,options});
      return Response.json(options.method==='POST'?nextRevision:[{revision:7,payload:{version:1}}]);
    };
    const store=new SupabaseStore({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_example',APP_INSTANCE:'test'});
    assert.deepEqual(await store.read(),{version:1});
    await store.write({version:1});assert.equal(JSON.parse(calls[1].options.body).p_expected,7);
    assert.equal(calls[0].options.headers.get('Authorization'),null);
    assert.equal(calls[0].options.headers.get('apikey'),'sb_secret_example');
    nextRevision=0;await assert.rejects(()=>store.write({version:1}),/資料已更新/);
  }finally{globalThis.fetch=original;}
});

test('cloud teachers require current allowlist and Auth validation; foreign lesson overwrite is denied',async()=>{
  const original=globalThis.fetch;let requests=0;
  const env={APP_MODE:'supabase',SESSION_SECRET:'unit-test-session-secret-32-characters-minimum',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable',TEACHER_EMAILS:'teacher@example.edu'};
  try {
    globalThis.fetch=async(url)=>{
      requests++;
      return Response.json(String(url).includes('/token?')?{access_token:'test-access-token',expires_in:3600}:{id:'teacher-one',email:'teacher@example.edu'});
    };
    const f=fixture(env);
    assert.equal((await f.call('/api/login','POST',{role:'teacher',email:'unauthorized@example.edu',password:'test-password'})).status,401);
    assert.equal(requests,0);
    assert.equal((await f.call('/api/login','POST',{role:'teacher',email:'teacher@example.edu',password:'test-password'})).status,200);
    assert.equal((await f.call('/api/me')).body.user.id,'teacher-one');
    const own=(await f.call('/api/dashboard')).body.lessons[0];
    f.data.lessons.foreign={...own,id:'foreign',ownerId:'teacher-two'};
    assert.equal((await f.call('/api/lessons/foreign','PUT',{lesson:{...own,id:'foreign'}})).status,403);
    assert.equal((await f.call('/api/lessons/foreign','DELETE')).status,403);
    env.TEACHER_EMAILS='other@example.edu';
    assert.equal((await f.call('/api/dashboard')).status,403);
    assert.equal((await f.call('/api/me')).body.user,null);
  }finally{globalThis.fetch=original;}
});

test('slow live AI does not block the Durable Object classroom command queue',async()=>{
  const original=globalThis.fetch,values=new Map();
  let finishProvider,announceStart;
  const started=new Promise(resolve=>{announceStart=resolve;});
  const provider=new Promise(resolve=>{finishProvider=resolve;});
  const storage=memoryStorage(values);
  const env={APP_MODE:'demo',AI_API_KEY:'test-only-no-real-key',AI_MODEL:'test-model',AI_BASE_URL:'https://provider.example/v1'};
  const object=new ClassroomDurableObject({storage},env);
  const request=(path,method='GET',body,cookie)=>new Request(`http://localhost${path}`,{method,headers:{Origin:'http://localhost','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:method==='GET'?undefined:JSON.stringify(body??{})});
  try {
    const login=await object.fetch(request('/api/login','POST',{role:'teacher'}));
    const cookie=login.headers.get('Set-Cookie').split(';')[0];
    const dashboard=await (await object.fetch(request('/api/dashboard','GET',null,cookie))).json();
    globalThis.fetch=async()=>{announceStart();return provider;};
    const ai=object.fetch(request('/api/ai','POST',{task:'lesson-review',lessonId:dashboard.lessons[0].id},cookie));
    await started;
    const responsive=await Promise.race([object.fetch(request('/api/dashboard','GET',null,cookie)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('AI blocked the classroom queue')),500))]);
    assert.equal(responsive.status,200);
    finishProvider(Response.json({choices:[{message:{content:'測試分析'}}]}));
    assert.equal((await (await ai).json()).mode,'live');
    assert.equal(Object.values((await new DurableStore(storage).read()).aiUsage)[0],1);
  }finally{finishProvider?.(Response.json({choices:[{message:{content:'測試清理'}}]}));globalThis.fetch=original;}
});

test('DurableStore chunks multi-megabyte snapshots and rolls back a partial failure atomically',async()=>{
  const values=new Map();let fail=false;
  const storage=memoryStorage(values,key=>fail&&key==='classroom-state:chunk:1');
  const store=new DurableStore(storage);
  // Legacy one-key snapshots migrate without changing data.
  values.set('classroom-state',{before:'legacy'});
  assert.deepEqual(await store.read(),{before:'legacy'});
  const large={text:'白板測試'.repeat(220000),answers:[1,2,3]};
  await store.write(large);
  assert(!values.has('classroom-state'));assert(values.get('classroom-state:manifest').chunks>32);
  assert.deepEqual(await new DurableStore(storage).read(),large);
  fail=true;await assert.rejects(()=>store.write({text:'x'.repeat(150000)}),/Injected storage failure/);
  assert.deepEqual(await store.read(),large);
  fail=false;await store.write({small:true});
  assert.deepEqual(await store.read(),{small:true});assert.equal([...values.keys()].filter(key=>key.includes(':chunk:')).length,1);
  await assert.rejects(()=>store.write({oversized:'x'.repeat(MAX_SNAPSHOT_BYTES)}),/8 MiB/);
  assert.deepEqual(await store.read(),{small:true});
});

test('authenticated teacher restores a generated backup larger than the normal command cap',async()=>{
  const {f,lesson,session}=await setup();
  const backup=(await f.call('/api/backup')).body;
  const activity=lesson.slides.find(s=>s.activity?.type==='short').activity;
  backup.sessions[0].answers=Array.from({length:650},(_,i)=>({id:`answer-${i}`,submissionId:`submission-${i}`,userId:'ignored',seat:1,activityId:activity.id,value:'r'.repeat(1900),submittedAt:new Date().toISOString()}));
  backup.sessions[0].session.id='restore-large-test';
  assert(JSON.stringify(backup).length>1048576);
  const result=await f.call('/api/restore','POST',{backup});assert.equal(result.status,200);
  assert.equal(f.data.sessions['restore-large-test'].answers.length,650);
  assert.equal(f.data.sessions[session.id].answers.length,0);
  assert.equal((await f.call('/api/restore','POST',{backup},'student')).status,403);
  const tooLarge=await f.call('/api/restore','POST',{backup,padding:'x'.repeat(9*1024*1024)});assert.equal(tooLarge.status,413);
});
