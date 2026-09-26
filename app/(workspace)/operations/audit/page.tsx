import { WorkstationData } from "@/components/WorkstationData";

export default function AuditPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Audit Trail</h1>
        <p className="page-subtitle">
          Append-only operation events, actor mutations, tenant changes, and delivery audit.
        </p>
      </div>
      <WorkstationData section="audit" enabled={isConfigured} />
    </>
  );
}
