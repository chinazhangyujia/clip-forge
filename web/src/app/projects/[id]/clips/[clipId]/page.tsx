import { ClipDetail } from "@/components/screens/ClipDetail";

export default async function ClipDetailPage({
  params,
}: {
  params: Promise<{ id: string; clipId: string }>;
}) {
  const { id, clipId } = await params;
  return <ClipDetail projectId={id} clipId={clipId} />;
}
