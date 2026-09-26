import { WorkstationData } from "@/components/WorkstationData";

export default function TasksPage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <div className="page-header">
        <h1>Tasks &amp; Tickets</h1>
        <p className="page-subtitle">
          Human work items, escalations, priority lifecycle, and customer context.
        </p>
      </div>
      <WorkstationData section="tasks" enabled={isConfigured} />
    </>
  );
}
