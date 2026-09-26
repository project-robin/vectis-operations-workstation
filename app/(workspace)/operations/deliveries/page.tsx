import { WorkstationData } from "@/components/WorkstationData";

export default function DeliveriesPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Deliveries</h1>
        <p className="page-subtitle">
          Twenty CRM delivery outbox, idempotency claims, and retry attempts.
        </p>
      </div>
      <WorkstationData section="deliveries" enabled={isConfigured} />
    </>
  );
}
