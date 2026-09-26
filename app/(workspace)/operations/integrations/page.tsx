import { WorkstationData } from "@/components/WorkstationData";

export default function IntegrationsPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Integrations</h1>
        <p className="page-subtitle">
          Provider bindings, health state, and secret references (Dograh, Twenty, Hermes).
        </p>
      </div>
      <WorkstationData section="integrations" enabled={isConfigured} />
    </>
  );
}
