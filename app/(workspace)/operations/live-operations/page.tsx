import { WorkstationData } from "@/components/WorkstationData";

export default function LiveOperationsPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Live Operations</h1>
        <p className="page-subtitle">
          Real-time campaign execution, active provider runs, and live concurrency.
        </p>
      </div>
      <WorkstationData section="live-operations" enabled={isConfigured} />
    </>
  );
}
