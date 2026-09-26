import { WorkstationData } from "@/components/WorkstationData";

export default function ConversationsPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Conversations</h1>
        <p className="page-subtitle">
          Voice calls, structured outcomes, transcripts, and handoff records.
        </p>
      </div>
      <WorkstationData section="conversations" enabled={isConfigured} />
    </>
  );
}
