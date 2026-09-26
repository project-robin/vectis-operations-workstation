import { WorkstationData } from "@/components/WorkstationData";

export default function CampaignsPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Campaigns</h1>
        <p className="page-subtitle">
          Dograh campaign draft, approval, start/pause controls, and reconciliation state.
        </p>
      </div>
      <WorkstationData section="campaigns" enabled={isConfigured} />
    </>
  );
}
