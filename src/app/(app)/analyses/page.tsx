import { reportDemo } from "@/fixtures/report-demo";
import { ReportView } from "@/components/report/report-view";

export default function AnalysesPage() {
  return <ReportView analysis={reportDemo} mode="sample" />;
}
