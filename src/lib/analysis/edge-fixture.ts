import { unavailable } from '../api/http.ts';
import { createFixtureModel,fixtureMetadata } from './fixture.ts';
import { workerConfiguration } from './async-config.ts';
import { deepSeekPreflight } from './deepseek-prompt.ts';
/** DS3B1 test deployment only. No real-provider import or model transport. */
export function edgeFixtureConfiguration(get:(name:string)=>string|undefined){
  if(get('SUPABASE_URL')!=='https://abcdefghijklmnopqrst.supabase.co'
    ||get('ENABLE_EDGE_FIXTURE')!=='true'||get('ENABLE_EDGE_DEEPSEEK')==='true'||get('MODEL_API_KEY')!==undefined)throw unavailable();
  let keys:unknown;try{keys=JSON.parse(get('SUPABASE_SECRET_KEYS')??'');}catch{throw unavailable();}
  const key=keys&&typeof keys==='object'&&!Array.isArray(keys)?(keys as Record<string,unknown>).default:null;
  if(typeof key!=='string'||!key.startsWith('sb_secret_'))throw unavailable();
  return {url:'https://abcdefghijklmnopqrst.supabase.co',key,
    config:workerConfiguration({ANALYSIS_WORKER_MODEL_TIMEOUT_MS:'30000',ANALYSIS_USD_TO_CNY:'8',ANALYSIS_MAX_CALL_CNY:'1'})};
}
export function edgeFixtureModel(){
  const fixture=createFixtureModel({NODE_ENV:'test',ENABLE_ANALYSIS_FIXTURE:'true',ANALYSIS_MODEL_TIMEOUT_MS:'5000'});
  return {model:async(...args:Parameters<typeof fixture.generate>)=>JSON.parse(JSON.stringify(await fixture.generate(...args))) as unknown,
    metadata:fixtureMetadata,fixture:true,metrics:()=>null,preflight:deepSeekPreflight,calls:fixture.calls};
}
