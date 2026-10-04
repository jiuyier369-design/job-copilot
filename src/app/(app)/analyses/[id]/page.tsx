import { SavedReportHost } from '@/components/report/saved-report-host';
export default async function AnalysisPage({params}:{params:Promise<{id:string}>}){
  return <SavedReportHost id={(await params).id}/>;
}
