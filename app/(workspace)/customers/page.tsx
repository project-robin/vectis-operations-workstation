import { WorkstationData } from "@/components/WorkstationData";

export default function CustomersPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Customers</h1>
        <p className="page-subtitle">
          Canonical tenant identity, current opportunity, and unified timeline.
        </p>
      </div>
      <WorkstationData section="customers" enabled={isConfigured} />
    </>
  );
}
