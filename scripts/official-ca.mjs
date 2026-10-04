import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CA_PATH=resolve('supabase/.temp/prod-ca.crt');
export function inspectCa(ca,now=Date.now()) {
  const certificate=new X509Certificate(ca);
  const valid=certificate.ca&&Date.parse(certificate.validFrom)<=now&&now<Date.parse(certificate.validTo);
  if(!valid)throw Error('CA_INVALID');
  return {parsed:true,isCA:certificate.ca,subject:certificate.subject,issuer:certificate.issuer,
    sha256:certificate.fingerprint256,validFrom:new Date(certificate.validFrom).toISOString(),validTo:new Date(certificate.validTo).toISOString(),
    selfSignatureValid:certificate.checkIssued(certificate)&&certificate.verify(certificate.publicKey)};
}
export function dotnetClient(mode,target) {
  // Isolate the client from credentials. Only OS paths and the TLS target/CA travel to its process.
  const env=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','PSModulePath'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{JC_TLS_CA_FILE:CA_PATH,...(target?{JC_TLS_HOST:target.host,JC_TLS_PORT:String(target.port)}:{})});
  const child=spawnSync('pwsh',['-NoLogo','-NoProfile','-File','scripts/verify-postgres-dotnet.ps1','-Mode',mode],
    {env,encoding:'utf8',timeout:20000,windowsHide:true});
  // Raw stderr may include a target. Never forward it; JSON is emitted by fixed internal code only.
  if(child.status!==0||child.error)throw Error('INDEPENDENT_CLIENT_FAILED');
  const result=JSON.parse(child.stdout.trim());
  if(result.errorCode==='LOCAL_TLS_CLIENT_FAILED')throw Error('INDEPENDENT_CLIENT_FAILED');
  return result;
}
export function loadOfficialCa() {
  const ca=readFileSync(CA_PATH);return {ca,summary:inspectCa(ca)};
}
export function officialCaGate(results) {
  return ['node','dotnet-schannel'].every(client=>results.some(r=>r.client===client&&r.result==='passed'&&r.authorized===true
    &&r.chainAnchoredToProvidedCa===true&&r.certificate?.sanMatchesTarget===true));
}
