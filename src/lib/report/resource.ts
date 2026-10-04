import type { JobAnalysisRecord } from '../../types/job-copilot.ts';
import { object, text, nullable, integer, oneOf, profileSchema, jdItemsSchema, reportSchema } from './schema.ts';
import { validateReport } from './validate.ts';
import { validJdResource } from '../jd/client.ts';

export const validAnalysisId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Shared read validation. Use stored snapshots only; never substitute current data. */
export async function validAnalysisRecord(value: unknown): Promise<boolean> {
  try {
    const errors: string[] = [];
    object({id:text,userId:text,company:text,jobTitle:text,city:nullable(text),direction:nullable(text),
      jdText:text,jdSourceUrl:nullable(text),jdItems:jdItemsSchema,jdConfirmationSnapshot:()=>{},
      profileVersion:integer,profileSnapshot:profileSchema,report:reportSchema,
      reportStructureVersion:oneOf('1.0.0'),promptVersion:text,modelProvider:text,modelName:text,
      testDataVersion:nullable(text),createdAt:text})(value,'analysis',errors);
    if(errors.length) return false;
    const r=value as JobAnalysisRecord;
    if(!validAnalysisId(r.id)||!validAnalysisId(r.userId)||!Number.isSafeInteger(r.profileVersion)||r.profileVersion<1
      ||!Number.isFinite(Date.parse(r.createdAt)))return false;
    if(r.jdSourceUrl!==null && !['http:','https:'].includes(new URL(r.jdSourceUrl).protocol))return false;
    if(r.jdConfirmationSnapshot!==null){
      const d=r.jdConfirmationSnapshot;
      if(!await validJdResource(d)||!d.confirmation||d.rawText!==r.jdText)return false;
      const items=d.segments.flatMap(s=>s.category&&s.category!=='background'
        ?[{jdId:s.id,kind:s.category,exactText:d.rawText.slice(s.start,s.end)}]:[]);
      if(JSON.stringify(items)!==JSON.stringify(r.jdItems.map(i=>({jdId:i.jdId,kind:i.kind,exactText:i.exactText}))))return false;
    }
    validateReport(r.report,{jdText:r.jdText,jdItems:r.jdItems,profile:r.profileSnapshot});
    return true;
  }catch{return false;}
}
export const reportColumns='id,user_id,company,job_title,city,direction,jd_text,jd_source_url,jd_items,jd_confirmation_snapshot,profile_version,profile_snapshot,report,report_structure_version,prompt_version,model_provider,model_name,test_data_version,created_at';
export async function analysisFromRow(value:unknown,owner:string,id:string):Promise<JobAnalysisRecord|null>{
  if(!value||typeof value!=='object')return null;
  const row=value as Record<string,unknown>;
  if(row.user_id!==owner||row.id!==id)return null;
  const mapped=Object.fromEntries(reportColumns.split(',').map(key=>[key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),row[key]]));
  return await validAnalysisRecord(mapped)?mapped as unknown as JobAnalysisRecord:null;
}
