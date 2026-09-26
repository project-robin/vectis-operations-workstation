import { CallDetailPage } from "@/components/pages/CallDetailPage";

export default async function Page({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  return <CallDetailPage callId={callId} />;
}
