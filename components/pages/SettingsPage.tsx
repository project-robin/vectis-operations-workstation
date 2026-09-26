"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { errorText, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

type Agent = { id: number; name: string; status: string; isQuickCallAgent: boolean };
type Agents = {
  agents: Agent[];
  defaultLeadAgentWorkflowId: number | null;
  quickCallWorkflowId: number | null;
};
type ConnectionStatus = {
  ok: boolean;
  detail: string;
  reason?: "missing" | "expired" | "unauthorized" | "unreachable";
};
type Connections = {
  dograh: ConnectionStatus;
  twenty: ConnectionStatus;
  quickCall: ConnectionStatus;
  webhook: ConnectionStatus;
};

export function SettingsPage() {
  const workspace = useQuery(api.workspace.current, {});
  const updateSettings = useMutation(api.workspace.updateSettings);
  const listAgents = useAction(api.agents.list);
  const checkConnections = useAction(api.agents.checkConnections);
  const [businessName, setBusinessName] = useState("");
  const [agents, setAgents] = useState<Agents | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (workspace) setBusinessName(workspace.businessName);
  }, [workspace]);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const result = await checkConnections({});
      setConnections(result);
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) });
    } finally {
      setChecking(false);
    }
    try {
      setAgents(await listAgents({}));
    } catch {
      setAgents(null);
    }
  }, [checkConnections, listAgents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (patch: Parameters<typeof updateSettings>[0], message: string) => {
    setNotice(null);
    try {
      await updateSettings(patch);
      setNotice({ tone: "success", text: message });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) });
    }
  };

  if (!workspace) return <Text color="secondary">Loading settings…</Text>;

  const canEdit = workspace.role === "owner";
  const leadAgents = agents?.agents.filter((agent) => !agent.isQuickCallAgent) ?? [];
  const defaultAgent = agents?.defaultLeadAgentWorkflowId;
  const agentOptions = [
    {
      value: "default",
      label: defaultAgent ? `Default agent (#${defaultAgent})` : "Choose a lead agent",
    },
    ...leadAgents.map((agent) => ({
      value: String(agent.id),
      label: `${agent.name} (#${agent.id})`,
    })),
  ];
  const connectionRows = connections
    ? ([
        ["Dograh voice agents", connections.dograh],
        ["Quick call agent", connections.quickCall],
        ["Call results webhook", connections.webhook],
        ["Twenty CRM", connections.twenty],
      ] as const)
    : [];

  return (
    <VStack gap={8}>
      <PageHeader
        title="Settings"
        subtitle="Business details, calling preferences, and live connections."
      />
      {notice ? (
        <Banner
          status={notice.tone}
          title={notice.tone === "error" ? "Settings could not be saved" : "Settings saved"}
          description={notice.text}
          isDismissable={notice.tone === "success"}
        />
      ) : null}

      <Section variant="transparent" padding={0} paddingInline={8}>
        <VStack gap={4} maxWidth={640}>
          <VStack gap={1}>
            <Heading level={2}>Business</Heading>
            <Text color="secondary">The agent uses this name when introducing itself.</Text>
          </VStack>
          <TextInput
            label="Business name"
            value={businessName}
            onChange={setBusinessName}
            width="100%"
            isRequired
            isDisabled={!canEdit}
          />
          <Button
            label="Save business name"
            variant="secondary"
            isDisabled={!canEdit || !businessName.trim() || businessName === workspace.businessName}
            onClick={() => void save({ businessName }, "Business name updated.")}
          />
        </VStack>
      </Section>

      <Section variant="muted" padding={6} paddingInline={8}>
        <VStack gap={5} maxWidth={720}>
          <VStack gap={1}>
            <Heading level={2}>Calling</Heading>
            <Text color="secondary">
              Choose the agent for lead campaigns. Quick calls use your custom brief.
            </Text>
          </VStack>
          <Selector
            label="Dograh agent for leads"
            options={agentOptions}
            value={
              workspace.leadAgentWorkflowId === null
                ? "default"
                : String(workspace.leadAgentWorkflowId)
            }
            onChange={(value) =>
              void save(
                { leadAgentWorkflowId: value === "default" ? null : Number(value) },
                "Lead agent updated.",
              )
            }
            isDisabled={!canEdit || !agents}
            width="100%"
          />
          <Switch
            label="Save finished calls to Twenty CRM"
            description="Create a contact, call note, and follow-up task when needed."
            value={workspace.crmSyncEnabled}
            onChange={(checked) =>
              void save(
                { crmSyncEnabled: checked },
                checked ? "CRM sync enabled." : "CRM sync paused.",
              )
            }
            isDisabled={!canEdit}
          />
        </VStack>
      </Section>

      <Section variant="transparent" padding={0} paddingInline={8}>
        <VStack gap={5}>
          <HStack gap={4} justify="between" align="center" wrap="wrap">
            <VStack gap={1}>
              <Heading level={2}>Connections</Heading>
              <Text color="secondary">
                Checked against the live services, including an authenticated Twenty request.
              </Text>
            </VStack>
            <Button
              label="Check again"
              variant="secondary"
              onClick={() => void refresh()}
              isLoading={checking}
            />
          </HStack>
          {connections ? (
            <VStack gap={4}>
              {connectionRows.map(([label, status]) => (
                <HStack key={label} gap={4} align="center" justify="between" wrap="wrap">
                  <Text weight="semibold">{label}</Text>
                  <HStack gap={2} align="center" wrap="wrap">
                    <StatusDot
                      variant={status.ok ? "success" : "error"}
                      label={status.ok ? "Connected" : "Needs attention"}
                    />
                    <Text>{status.ok ? "Connected" : "Needs attention"}</Text>
                    <Text type="supporting" color="secondary">
                      {status.detail}
                    </Text>
                  </HStack>
                </HStack>
              ))}
            </VStack>
          ) : (
            <Text color="secondary">Checking connections…</Text>
          )}

          {connections && !connections.twenty.ok ? (
            <Banner
              status="error"
              title={
                connections.twenty.reason === "expired"
                  ? "Twenty API key expired"
                  : "Twenty CRM needs a valid API key"
              }
              description="Create a new key in Twenty Settings → API & Webhooks, replace TWENTY_API_KEY in the Convex deployment, then check again. Existing failed call syncs may need retrying."
              endContent={
                <Link href="https://docs.twenty.com/developers/extend/api" isExternalLink>
                  Twenty API guide
                </Link>
              }
            />
          ) : null}
        </VStack>
      </Section>
    </VStack>
  );
}
