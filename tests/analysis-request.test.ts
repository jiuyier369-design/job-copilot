import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysisRequest } from '../src/lib/analysis/pipeline.ts';
const input = { requestId:'11111111-1111-4111-8111-111111111111',draftId:'33333333-3333-4333-8333-333333333333',
  expectedDraftRevision:2,expectedProfileVersion:1,company:'虚构',jobTitle:'测试',city:null,direction:null,jdSourceUrl:null };
test('generation accepts only references, versions, UUID and bounded job metadata',()=>{
  assert.deepEqual(parseAnalysisRequest(input),input);
  for(const key of ['userId','jdText','jdItems','profile','confirmation','report','provider','model','promptVersion','requestFingerprint']) {
    assert.throws(()=>parseAnalysisRequest({...input,[key]:'sensitive'}));
  }
  for(const extra of [{requestId:'bad'},{expectedProfileVersion:0},{company:' '},{company:'a'.repeat(201)},{jdSourceUrl:'javascript:alert(1)'}]) {
    assert.throws(()=>parseAnalysisRequest({...input,...extra}));
  }
  const {requestId:_,...missing}=input; assert.throws(()=>parseAnalysisRequest(missing));
});
