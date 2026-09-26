export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <>
      <div className="page-header">
        <h1>Customer Detail</h1>
        <p className="page-subtitle">ID: {customerId}</p>
      </div>
      <div className="record-panel">
        <p className="data-note">
          Timeline, verified opportunities, and commercial evidence for customer {customerId}.
        </p>
      </div>
    </>
  );
}
