import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { WorkstationData } from "@/components/WorkstationData";

export default function HomePage() {
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <VStack gap={6}>
      <header className="page-header">
        <Heading level={1}>Vectis today</Heading>
        <Text type="body" color="secondary" className="page-subtitle">
          Commercial evidence required for all revenue and funnel attribution.
        </Text>
      </header>
      <WorkstationData section="home" enabled={isConfigured} />
    </VStack>
  );
}
