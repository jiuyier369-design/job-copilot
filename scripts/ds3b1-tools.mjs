// Dedicated test project orchestration. No raw errors, CLI streams or credential values are logged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createRequire } from 'node:module';
import { CLI_VERSION } from './supabase-migrate.mjs';
import { sessionPoolerTarget } from './supabase-migrate.mjs';
import { loadOfficialCa } from './official-ca.mjs';
import { initializePostgres } from './postgres-init.mjs';
import { query,management,TEST_REF,SIX } from './async-remote.mjs';

export function safeCode(error){
  const code=error?.code;
  return typeof code==='string'&&/^(?:[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+)$/.test(code)?code:null;
}
export async function waitForPortRelease(check,attempts=20,intervalMs=250){
  for(let n=0;n<attempts;n++){
    if(await check())return;
    if(n+1<attempts)await new Promise(resolve=>setTimeout(resolve,intervalMs));
  }
  throw Error('LOCAL_PORT_NOT_RELEASED');
}
export function fixedCli(){
  for(const dir of readdirSync(join(process.env.LOCALAPPDATA,'npm-cache','_npx'))){
    const folder=join(process.env.LOCALAPPDATA,'npm-cache','_npx',dir,'node_modules','@supabase',`cli-windows-${process.arch}`);
    if(existsSync(join(folder,'package.json'))&&existsSync(join(folder,'bin','supabase.exe'))
      &&JSON.parse(readFileSync(join(folder,'package.json'),'utf8')).version===CLI_VERSION)return join(folder,'bin','supabase.exe');
  }
  throw Error('FIXED_CLI_UNAVAILABLE');
}
export function cli(args){
  assert.equal(process.env.SUPABASE_PROJECT_REF,TEST_REF);
  const env=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','SUPABASE_ACCESS_TOKEN']
    .filter(n=>process.env[n]).map(n=>[n,process.env[n]]));
  const start=performance.now();
  const result=spawnSync(fixedCli(),[...args,'--project-ref',TEST_REF],{env,encoding:'utf8',timeout:90000,windowsHide:true,input:''});
  // Discard CLI output; it is not needed as evidence and may include sensitive values on failures.
  if(result.error||result.status!==0){const error=Error('CLI_FAILED');error.exitCode=result.status;throw error;}
  return {exitCode:0,elapsedMs:Math.round(performance.now()-start)};
}
export async function counts(){
  const [row]=await query(`select
    (select count(*)::int from auth.users where email like 'jc-test-%') as accounts,
    (select count(*)::int from public.profiles) as profiles,
    (select count(*)::int from public.jd_drafts) as jd_drafts,
    (select count(*)::int from public.job_analyses) as job_analyses,
    (select count(*)::int from public.applications) as applications,
    (select count(*)::int from public.analysis_runs) as analysis_runs,
    (select count(*)::int from public.analysis_runs where status='processing') as processing,
    (select count(*)::int from public.analysis_run_jobs) as jobs,
    (select count(*)::int from pgmq.q_job_copilot_analysis) as active,
    (select count(*)::int from pgmq.a_job_copilot_analysis) as archived;`);
  assert.ok(Object.values(row).every(n=>Number.isSafeInteger(n)&&n>=0));return row;
}
export async function idle(){const result=await counts();assert.ok(Object.values(result).every(n=>n===0));return result;}
export async function preflight(){
  const [r]=await query(`select
    (select array_agg(version order by version) from supabase_migrations.schema_migrations) as versions,
    (select count(*)::int from vault.secrets) as vault,
    case when to_regclass('cron.job') is null then 0 else 1 end as cron_table;`);
  assert.deepEqual(r.versions,[...SIX,'20261001000100']);assert.equal(r.vault,0);assert.equal(r.cron_table,0);
  const functions=await management('/functions'),secrets=await management('/secrets');
  assert.ok(!functions.some(f=>f.slug==='analysis-worker'));
  assert.ok(!secrets.some(s=>['MODEL_API_KEY','JC_SUPABASE_SECRET_KEY','JOB_COPILOT_WORKER_TOKEN','ENABLE_EDGE_FIXTURE'].includes(s.name)));
  return {versions:r.versions,vault:0,edgeAbsent:true,cronAbsent:true,modelSecretAbsent:true,counts:await idle()};
}
export async function preflightExisting(){
  const [row]=await query(`select
    (select array_agg(version order by version) from supabase_migrations.schema_migrations) as versions,
    to_regclass('cron.job') is null as cron_absent;`);
  assert.deepEqual(row.versions,[...SIX,'20261001000100']);assert.equal(row.cron_absent,true);
  const vault=await query('select name,(secret is not null and length(secret)>0) as nonempty from vault.secrets order by name');
  assert.deepEqual(vault.map(r=>r.name).sort(),[...vaultNames].sort());assert.ok(vault.every(r=>r.nonempty));
  const functions=await management('/functions'),secrets=await management('/secrets');
  const worker=functions.find(f=>f.slug==='analysis-worker');assert.ok(worker&&worker.status==='ACTIVE');
  assert.ok(secrets.some(s=>s.name==='JOB_COPILOT_WORKER_TOKEN'));
  assert.ok(!secrets.some(s=>['MODEL_API_KEY','JC_SUPABASE_SECRET_KEY'].includes(s.name)));
  return {versions:row.versions,cronAbsent:true,vault,edge:{name:'analysis-worker',version:worker.version,status:worker.status},
    workerTokenPresent:true,modelKeyAbsent:true,counts:await idle()};
}
export async function postgres(log=()=>{}){
  // Isolated, pinned tooling dependency; does not alter the application dependency tree.
  return initializePostgres({
    loadPg:()=>{const require=createRequire(resolve('.supabase-test-logs/pg-tool/package.json'));return {Client:require('pg').Client,version:require('pg/package.json').version};},
    parseTarget:()=>new URL(sessionPoolerTarget(readFileSync('supabase/.temp/pooler-url','utf8'),TEST_REF)),
    loadCa:()=>loadOfficialCa().ca,password:()=>process.env.SUPABASE_DB_PASSWORD,log,
  });
}
export const vaultNames=['job_copilot_project_url','job_copilot_publishable_key','job_copilot_worker_token'];
export async function vaultWrite(client,token,verify=query){
  assert.equal(process.env.TEST_SUPABASE_URL,`https://${TEST_REF}.supabase.co`);
  assert.ok(process.env.TEST_SUPABASE_PUBLIC_KEY&&token);
  // Bind values in the PostgreSQL protocol. No secret interpolation into SQL, logs or migrations.
  await client.query('BEGIN');
  try{
    const {rows}=await client.query('select count(*)::int as count from vault.secrets');assert.equal(rows[0].count,0);
    const values=[process.env.TEST_SUPABASE_URL,process.env.TEST_SUPABASE_PUBLIC_KEY,token];
    for(let i=0;i<vaultNames.length;i++)await client.query('select vault.create_secret($1::text,$2::text)',[values[i],vaultNames[i]]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  const result=await verify(`select name,(secret is not null and length(secret)>0) as nonempty from vault.secrets order by name;`);
  assert.deepEqual(result.map(r=>r.name).sort(),[...vaultNames].sort());assert.ok(result.every(r=>r.nonempty===true));
  return result; // No decrypted view is queried, locally or remotely.
}
