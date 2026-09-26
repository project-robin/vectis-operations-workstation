export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <>
      <div className="page-header">
        <h1>Conversation Detail</h1>
        <p className="page-subtitle">ID: {conversationId}</p>
      </div>
      <div className="record-panel">
        <p className="data-note">
          Interaction history, normalized business outcomes, and call transcripts.
        </p>
      </div>
    </>
  );
}
