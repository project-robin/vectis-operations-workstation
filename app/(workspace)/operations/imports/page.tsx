import { WorkstationData } from "@/components/WorkstationData";

export default function ImportsPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Imports</h1>
        <p className="page-subtitle">
          Consented CSV ingest, validation, staging, and batch commits.
        </p>
      </div>
      <WorkstationData section="imports" enabled={isConfigured} />
    </>
  );
}
