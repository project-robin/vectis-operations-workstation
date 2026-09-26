"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { errorText, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

export function OnboardingPage() {
  const router = useRouter();
  const workspace = useQuery(api.workspace.current, {});
  const dashboard = useQuery(api.calls.dashboard, {});
  const updateSettings = useMutation(api.workspace.updateSettings);
  const dismissOnboarding = useMutation(api.workspace.dismissOnboarding);
  const [businessName, setBusinessName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (workspace) setBusinessName(workspace.businessName);
  }, [workspace]);

  if (!workspace || !dashboard) {
    return <Text color="secondary">Preparing your workspace…</Text>;
  }

  const canEdit = workspace.role === "owner";
  const totalCalls =
    dashboard.calls.queued +
    dashboard.calls.in_progress +
    dashboard.calls.completed +
    dashboard.calls.no_answer +
    dashboard.calls.failed;
  const businessReady = workspace.onboardingBusinessNamed || totalCalls > 0;
  const callStarted = totalCalls > 0;
  const firstResult = dashboard.calls.completed > 0;
  const completed = Number(businessReady) + Number(callStarted) + Number(firstResult);
  const activeStep = businessReady ? (callStarted ? (firstResult ? 3 : 2) : 1) : 0;
  const running = dashboard.calls.queued + dashboard.calls.in_progress > 0;
  const latestCompleted = dashboard.recentCalls.find(
    (call: { status: string }) => call.status === "completed",
  );

  const saveBusiness = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await updateSettings({ businessName: businessName.trim() });
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await dismissOnboarding({});
      router.replace("/");
    } catch (error) {
      setNotice(errorText(error));
      setSaving(false);
    }
  };

  return (
    <VStack gap={8}>
      <PageHeader
        title="Get started"
        subtitle="One useful call is the fastest way to see what Vectis can do for your business."
        actions={
          canEdit && !firstResult ? (
            <Button
              label="Skip for now"
              variant="ghost"
              onClick={() => void skip()}
              isLoading={saving}
            />
          ) : (
            <Button label="Open dashboard" href="/" variant="secondary" />
          )
        }
      />

      {notice ? (
        <Banner status="error" title="Could not save your progress" description={notice} />
      ) : null}
      {firstResult ? (
        <Banner
          status="success"
          title="Your first call has a result"
          description="Open the call to review what the agent learned, then bring in more leads when you are ready."
          endContent={
            <Button
              label="View call"
              href={latestCompleted ? `/calls/${latestCompleted._id}` : "/calls"}
              variant="secondary"
            />
          }
        />
      ) : null}

      <Section variant="transparent" padding={0} paddingInline={8}>
        <VStack gap={5} maxWidth={720}>
          <VStack gap={1}>
            <Heading level={2}>Your first result</Heading>
            <Text color="secondary">
              {completed} of 3 steps complete. You can return to this guide any time.
            </Text>
          </VStack>
          <Stepper activeStep={activeStep} orientation="vertical" label="Workspace setup">
            <Step
              step={0}
              label="Name your business"
              description="The agent uses this name when introducing the call."
              status={businessReady ? "success" : undefined}
            >
              {businessReady ? (
                <VStack gap={2}>
                  <Text>{workspace.businessName}</Text>
                  <Link href="/settings" isStandalone>
                    Change business details
                  </Link>
                </VStack>
              ) : (
                <form onSubmit={(event) => void saveBusiness(event)}>
                  <VStack gap={3}>
                    <TextInput
                      label="Business name"
                      value={businessName}
                      onChange={setBusinessName}
                      isRequired
                      width="100%"
                      isDisabled={!canEdit}
                    />
                    <Button
                      label="Save business name"
                      type="submit"
                      variant="primary"
                      isLoading={saving}
                      isDisabled={!canEdit || !businessName.trim()}
                    />
                  </VStack>
                </form>
              )}
            </Step>
            <Step
              step={1}
              label="Make a first call"
              description="Tell the agent who to call and what to ask."
              status={callStarted ? "success" : undefined}
            >
              <VStack gap={3}>
                <Text color="secondary">
                  {callStarted
                    ? `${totalCalls} call${totalCalls === 1 ? "" : "s"} started in this workspace.`
                    : "Call a number you can answer to hear the agent and see a real result."}
                </Text>
                <HStack gap={2} wrap="wrap">
                  <Button
                    label={callStarted ? "Make another call" : "Set up a quick call"}
                    href="/quick-call"
                    variant={businessReady && !callStarted ? "primary" : "secondary"}
                  />
                  <Link href="/leads" isStandalone>
                    Add leads for a campaign
                  </Link>
                </HStack>
              </VStack>
            </Step>
            <Step
              step={2}
              label="Review the result"
              description="See the summary and any follow-up the agent found."
              status={firstResult ? "success" : running ? "accent" : undefined}
            >
              <VStack gap={3}>
                <Text color="secondary">
                  {firstResult
                    ? "Your completed call is ready to review."
                    : running
                      ? "Your call is running. The result will appear automatically when it finishes."
                      : callStarted
                        ? "The first attempt did not complete a conversation. Try another number or review the call details."
                        : "Once a call completes, its summary and next steps appear here."}
                </Text>
                <Button
                  label={firstResult ? "Review completed call" : "View calls"}
                  href={latestCompleted ? `/calls/${latestCompleted._id}` : "/calls"}
                  variant="secondary"
                />
              </VStack>
            </Step>
          </Stepper>
        </VStack>
      </Section>

      <Section variant="muted" padding={6} paddingInline={8}>
        <VStack gap={3}>
          <Heading level={2}>When you are ready for more</Heading>
          <Text color="secondary">
            Import a lead list, choose an agent for campaigns, and connect Twenty CRM to save call
            notes automatically. These are optional for your first call.
          </Text>
          <HStack gap={5} wrap="wrap">
            <Link href="/leads" isStandalone>
              Manage leads
            </Link>
            <Link href="/settings" isStandalone>
              Review connections
            </Link>
          </HStack>
        </VStack>
      </Section>
    </VStack>
  );
}
