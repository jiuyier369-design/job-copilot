// One connection, no retries. Only fixed stages/categories leave this module.
export const POSTGRES_STAGES=Object.freeze(['pg-dependency','pg-pooler-target','pg-official-ca','pg-client','pg-tcp','pg-tls','pg-auth','pg-first-query']);
export const ERROR_CATEGORIES=Object.freeze(['UNKNOWN','DEPENDENCY_INVALID','TARGET_INVALID','CA_INVALID','CREDENTIAL_MISSING','CLIENT_INVALID',
  'DEPENDENCY_MISSING','FILE_NOT_FOUND','FILESYSTEM_DENIED','DNS_FAILED','TCP_REFUSED','CONNECTION_RESET','NETWORK_UNREACHABLE',
  'REQUEST_TIMEOUT','TLS_CHAIN_FAILED','TLS_CERT_INVALID','TLS_HOSTNAME_FAILED','TLS_HANDSHAKE_FAILED','TLS_NOT_AUTHORIZED',
  'AUTH_REJECTED','PERMISSION_DENIED','DATABASE_UNAVAILABLE','QUERY_CANCELLED','DATABASE_CONNECTION_FAILED','BUSINESS_CONFLICT','CONSTRAINT_REJECTED','ASSERTION_FAILED']);
const codes={MODULE_NOT_FOUND:'DEPENDENCY_MISSING',ERR_MODULE_NOT_FOUND:'DEPENDENCY_MISSING',ENOENT:'FILE_NOT_FOUND',EACCES:'FILESYSTEM_DENIED',EPERM:'FILESYSTEM_DENIED',
  ENOTFOUND:'DNS_FAILED',EAI_AGAIN:'DNS_FAILED',ECONNREFUSED:'TCP_REFUSED',ECONNRESET:'CONNECTION_RESET',EPIPE:'CONNECTION_RESET',
  ENETUNREACH:'NETWORK_UNREACHABLE',EHOSTUNREACH:'NETWORK_UNREACHABLE',ETIMEDOUT:'REQUEST_TIMEOUT',
  SELF_SIGNED_CERT_IN_CHAIN:'TLS_CHAIN_FAILED',DEPTH_ZERO_SELF_SIGNED_CERT:'TLS_CHAIN_FAILED',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS_CHAIN_FAILED',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'TLS_CHAIN_FAILED',CERT_HAS_EXPIRED:'TLS_CERT_INVALID',CERT_NOT_YET_VALID:'TLS_CERT_INVALID',CERT_REVOKED:'TLS_CERT_INVALID',
  ERR_TLS_CERT_ALTNAME_INVALID:'TLS_HOSTNAME_FAILED',ERR_SSL_WRONG_VERSION_NUMBER:'TLS_HANDSHAKE_FAILED',
  ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR:'TLS_HANDSHAKE_FAILED',ERR_SSL_UNEXPECTED_EOF_WHILE_READING:'TLS_HANDSHAKE_FAILED',
  '28P01':'AUTH_REJECTED','28000':'AUTH_REJECTED','42501':'PERMISSION_DENIED','53300':'DATABASE_UNAVAILABLE','57P03':'DATABASE_UNAVAILABLE',
  '57014':'QUERY_CANCELLED','08001':'DATABASE_CONNECTION_FAILED','08006':'DATABASE_CONNECTION_FAILED',PT409:'BUSINESS_CONFLICT',
  P0002:'CONSTRAINT_REJECTED','23505':'CONSTRAINT_REJECTED','23514':'CONSTRAINT_REJECTED',ERR_ASSERTION:'ASSERTION_FAILED'};
const own=(o,k)=>o&&typeof o==='object'?Object.getOwnPropertyDescriptor(o,k)?.value:undefined;
export const HANDSHAKE_EVENTS=Object.freeze(['tcp-connected','ssl-request-sent','ssl-reply','hostname-verified','hostname-rejected','tls-socket-established','secure-connect','socket-error','socket-close','connection-end','initialization-failed']);
import {checkServerIdentity} from 'node:tls';
const lifecycleCleanup=new WeakMap();
/** Observation only: closedBeforeVerification means closure preceded observed authorized secureConnect. */
export function safeHandshakeState(input){
  const state={};
  for(const key of ['tcpConnected','tlsSocketEstablished','secureConnect','socketClosed','closedBeforeVerification'])state[key]=own(input,key)===true;
  const authorized=own(input,'certificateAuthorized');state.certificateAuthorized=typeof authorized==='boolean'?authorized:null;
  const category=own(input,'socketErrorCategory'),code=own(input,'socketErrorCode');
  state.socketErrorCategory=ERROR_CATEGORIES.includes(category)?category:null;
  state.socketErrorCode=typeof code==='string'&&Object.hasOwn(codes,code)?code:null;
  return state;
}
export function safeInitializationFailure(error){
  const code=own(error,'code'),category=own(error,'category'),stage=own(error,'stage');
  const known=typeof code==='string'&&Object.hasOwn(codes,code);
  // Unknown suffixes can contain data; retain a category only, never the raw code.
  const tlsFamily=typeof code==='string'&&/^(ERR_SSL_|ERR_TLS_|CERT_|UNABLE_TO_|SELF_SIGNED_|DEPTH_ZERO_)/.test(code);
  return {postgresStage:POSTGRES_STAGES.includes(stage)?stage:null,
    errorCategory:ERROR_CATEGORIES.includes(category)?category:known?codes[code]:tlsFamily?'TLS_HANDSHAKE_FAILED':'UNKNOWN',
    errorCode:known?code:null};
}
export class PostgresInitializationError extends Error{
  constructor(stage,category,code=null){super('POSTGRES_INITIALIZATION_FAILED');this.stage=stage;this.category=category;this.code=code;}
}
/** @returns {Record<string,any>} */
export function safePostgresEvent(input){
  const stage=own(input,'stage'),state=own(input,'state'),elapsedMs=own(input,'elapsedMs');
  const failure=safeInitializationFailure(input),out={};
  if(POSTGRES_STAGES.includes(stage))out.stage=stage;
  if(['start','passed','stopped'].includes(state))out.state=state;
  if(Number.isSafeInteger(elapsedMs)&&elapsedMs>=0)out.elapsedMs=elapsedMs;
  if(state==='stopped'){out.errorCategory=failure.errorCategory;out.errorCode=failure.errorCode;}
  const event=own(input,'event');
  if(stage==='pg-tls'&&state==='observed'&&HANDSHAKE_EVENTS.includes(event)){
    out.state='observed';out.event=event;out.handshake=safeHandshakeState(own(input,'handshake'));
    if(own(input,'detailedLifecycle')===true){
      const reply=own(input,'sslReply');out.sslReply=['S','N','OTHER'].includes(reply)?reply:null;
      for(const key of ['sslRequestSent','hostnameVerified','closeRequested'])out[key]=own(input,key)===true;
    }
  }
  return out;
}
export async function closePostgres(client){
  if(!client)return;
  lifecycleCleanup.get(client)?.prepare();
  let timer;
  try{await Promise.race([Promise.resolve().then(()=>client.end()),new Promise(resolve=>{timer=setTimeout(()=>{client.connection?.stream?.destroy();resolve();},3000);})]);}
  catch{client.connection?.stream?.destroy();throw new PostgresInitializationError('pg-client','CLIENT_INVALID');}
  finally{clearTimeout(timer);lifecycleCleanup.get(client)?.detach();lifecycleCleanup.delete(client);}
}
/** @param {{loadPg:Function,parseTarget:Function,loadCa:Function,password:Function,log?:Function,timeoutMs?:number,detailedLifecycle?:boolean}} ports */
export async function initializePostgres(ports){
  const log=ports.log??(()=>{}),started=new Map();let current,client,timer,handshakePassed=false;
  const handshake=safeHandshakeState({}),listeners=[],watched=new WeakSet(),at=performance.now();let diagnosticActive=true;
  let sslReply=null,sslRequestSent=false,hostnameVerified=false,closeRequested=false,succeeded=false;
  const detailedLifecycle=ports.detailedLifecycle===true;
  function observe(event){if(diagnosticActive)log(safePostgresEvent({stage:'pg-tls',state:'observed',event,handshake,
    detailedLifecycle,sslReply,sslRequestSent,hostnameVerified,closeRequested,elapsedMs:Math.round(performance.now()-at)}));}
  function detach(){diagnosticActive=false;for(const remove of listeners)remove();}
  function listen(emitter,event,callback,once=false){emitter[once?'once':'on'](event,callback);listeners.push(()=>emitter.removeListener(event,callback));}
  function closed(event){handshake.socketClosed=true;handshake.closedBeforeVerification=!handshakePassed;observe(event);}
  function watchSocket(socket){
    if(!socket||watched.has(socket))return;watched.add(socket);
    listen(socket,'error',error=>{const safe=safeInitializationFailure(error);
      handshake.socketErrorCategory=safe.errorCategory;handshake.socketErrorCode=safe.errorCode;observe('socket-error');});
    listen(socket,'close',()=>closed('socket-close'));
  }
  function start(stage){current=stage;started.set(stage,performance.now());log(safePostgresEvent({stage,state:'start'}));}
  function pass(stage){log(safePostgresEvent({stage,state:'passed',elapsedMs:Math.round(performance.now()-started.get(stage))}));}
  function local(stage,fn,fallback){start(stage);try{const value=fn();pass(stage);return value;}
    catch(error){const safe=safeInitializationFailure(error);throw new PostgresInitializationError(stage,safe.errorCategory==='UNKNOWN'?fallback:safe.errorCategory,safe.errorCode);}}
  try{
    const Client=local('pg-dependency',()=>{const {Client,version}=ports.loadPg();if(version!=='8.16.3'||typeof Client!=='function')throw Error();return Client;},'DEPENDENCY_INVALID');
    const target=local('pg-pooler-target',ports.parseTarget,'TARGET_INVALID');
    const ca=local('pg-official-ca',ports.loadCa,'CA_INVALID');
    client=local('pg-client',()=>{
      const password=ports.password();if(typeof password!=='string'||!password)throw new PostgresInitializationError('pg-client','CREDENTIAL_MISSING');
      return new Client({host:target.hostname,port:5432,user:decodeURIComponent(target.username),database:'postgres',password,
        ssl:{rejectUnauthorized:true,ca,servername:target.hostname,...(detailedLifecycle?{checkServerIdentity:(hostname,certificate)=>{
          // The same Node verifier, with the configured target; no certificate fields leave this closure.
          const error=checkServerIdentity(target.hostname,certificate);hostnameVerified=!error;observe(error?'hostname-rejected':'hostname-verified');return error;
        }}:{})},connectionTimeoutMillis:15000,query_timeout:15000,statement_timeout:12000,
        application_name:'job-copilot-fixture-acceptance'});
    },'CLIENT_INVALID');
    client.on('error',()=>{});
    watchSocket(client.connection.stream);
    function tcpConnected(){if(handshake.tcpConnected)return;handshake.tcpConnected=true;observe('tcp-connected');pass('pg-tcp');start('pg-tls');}
    if(detailedLifecycle){
      listen(client.connection.stream,'connect',tcpConnected,true);
      // pg 8.16.3 reads one plaintext SSLRequest reply before replacing this socket with TLS.
      // Observe only that first buffer; this listener is removed before any authentication traffic.
      listen(client.connection.stream,'data',buffer=>{
        sslReply=Buffer.isBuffer(buffer)&&buffer.length===1?(buffer[0]===83?'S':buffer[0]===78?'N':'OTHER'):'OTHER';observe('ssl-reply');
      },true);
      const original=client.connection.requestSsl;
      client.connection.requestSsl=function(){sslRequestSent=true;observe('ssl-request-sent');return original.call(this);};
      listeners.push(()=>{client.connection.requestSsl=original;});
    }
    listen(client.connection,'end',()=>closed('connection-end'));
    // pg's sslconnect only means a TLS socket was created; secureConnect proves the handshake.
    listen(client.connection,'connect',tcpConnected,true);
    listen(client.connection,'sslconnect',()=>{handshake.tlsSocketEstablished=true;observe('tls-socket-established');
      const socket=client.connection.stream;watchSocket(socket);
      listen(socket,'secureConnect',()=>{
        handshake.secureConnect=true;handshake.certificateAuthorized=socket.authorized===true;
        handshakePassed=handshake.certificateAuthorized;observe('secure-connect');
        if(handshakePassed){pass('pg-tls');start('pg-auth');}
      },true);},true);
    start('pg-tcp');
    await Promise.race([client.connect(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PostgresInitializationError(current,'REQUEST_TIMEOUT','ETIMEDOUT')),ports.timeoutMs??15000);})]);
    clearTimeout(timer);
    if(!handshakePassed||(detailedLifecycle&&(sslReply!=='S'||!hostnameVerified)))throw new PostgresInitializationError('pg-tls','TLS_NOT_AUTHORIZED');
    pass('pg-auth');start('pg-first-query');
    const result=await client.query('select 1::integer as probe');
    if(result.rows?.length!==1||result.rows[0].probe!==1)throw new PostgresInitializationError('pg-first-query','ASSERTION_FAILED','ERR_ASSERTION');
    pass('pg-first-query');succeeded=true;
    if(detailedLifecycle)lifecycleCleanup.set(client,{prepare:()=>{closeRequested=true;},detach});return client;
  }catch(error){
    // Capture observations before wrapping a code-less rejection and before our own cleanup closes sockets.
    observe('initialization-failed');if(!detailedLifecycle)diagnosticActive=false;
    clearTimeout(timer);const safe=safeInitializationFailure(error),stage=safe.postgresStage??current;
    if(detailedLifecycle&&safe.errorCategory==='UNKNOWN'){
      if(handshake.socketErrorCategory&&handshake.socketErrorCategory!=='UNKNOWN'){
        safe.errorCategory=handshake.socketErrorCategory;safe.errorCode=handshake.socketErrorCode;
      }else if(sslReply==='N'||sslReply==='OTHER')safe.errorCategory='TLS_HANDSHAKE_FAILED';
    }
    const projected=new PostgresInitializationError(stage,safe.errorCategory,safe.errorCode);
    log(safePostgresEvent({stage,state:'stopped',elapsedMs:Math.round(performance.now()-(started.get(stage)??performance.now())),...projected}));
    closeRequested=true;await closePostgres(client).catch(()=>{});throw projected;
  }finally{if(!succeeded||!detailedLifecycle)detach();}
}
