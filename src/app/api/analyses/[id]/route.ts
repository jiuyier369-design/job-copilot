import { requireUser } from '@/lib/auth/require-user';
import { boundedAnalysisFetch } from '@/lib/analysis/transport';
import { reportReadHandler } from '@/lib/report/read';

export const GET=(_request:Request,context:{params:Promise<{id:string}>})=>context.params.then(({id})=>
  reportReadHandler(()=>requireUser(boundedAnalysisFetch()))(id));
