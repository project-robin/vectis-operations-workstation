import { WorkstationData } from "@/components/WorkstationData";

export default function AgentsPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Agents</h1>
        <p className="page-subtitle">
          Configured Dograh workflow roles, operational health, and campaign controls.
        </p>
      </div>
      <WorkstationData section="agents" enabled={isConfigured} />
    </>
  );
}
