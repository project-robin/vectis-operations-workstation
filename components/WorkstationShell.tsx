"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { UserButton } from "@clerk/nextjs";
import {
  Activity,
  AudioLines,
  Bot,
  ChartNoAxesCombined,
  ClipboardList,
  Compass,
  ContactRound,
  Headphones,
  House,
  ListChecks,
  MessageSquareText,
  PhoneCall,
  PhoneOutgoing,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useVectisTheme } from "@/components/providers/VectisThemeProvider";
import { WorkspaceGate } from "@/components/WorkspaceGate";

export function WorkstationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { mode, setMode } = useVectisTheme();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const operationsActive = pathname.startsWith("/operations/");

  return (
    <AppShell
      variant="section"
      height="auto"
      contentPadding={0}
      sideNav={
        <SideNav
          header={
            <SideNavHeading
              heading="Vectis"
              subheading="Voice operations"
              headingHref="/"
              icon={<AudioLines aria-hidden="true" />}
            />
          }
          topContent={
            <Button
              label="Quick call"
              href="/quick-call"
              variant="primary"
              width="100%"
              icon={<PhoneOutgoing aria-hidden="true" />}
            />
          }
          footer={
            <VStack gap={3} padding={3}>
              <Switch
                label="Dark mode"
                value={mode === "dark"}
                onChange={(checked) => setMode(checked ? "dark" : "light")}
                size="sm"
                width="100%"
                labelSpacing="spread"
              />
              <UserButton
                showName
                appearance={{
                  elements: {
                    userButtonOuterIdentifier: { color: "var(--color-text-primary)" },
                  },
                }}
              />
            </VStack>
          }
          collapsible
        >
          <SideNavSection title="Calling">
            <SideNavItem
              label="Get started"
              href="/onboarding"
              icon={Compass}
              isSelected={isActive("/onboarding")}
            />
            <SideNavItem label="Dashboard" href="/" icon={House} isSelected={isActive("/")} />
            <SideNavItem
              label="Calls"
              href="/calls"
              icon={PhoneCall}
              isSelected={isActive("/calls")}
            />
            <SideNavItem label="Leads" href="/leads" icon={Users} isSelected={isActive("/leads")} />
            <SideNavItem
              label="Campaigns"
              href="/campaigns"
              icon={ListChecks}
              isSelected={isActive("/campaigns")}
            />
          </SideNavSection>
          <SideNavSection title="Workspace">
            <SideNavItem
              label="Home"
              href="/home"
              icon={Headphones}
              isSelected={isActive("/home")}
            />
            <SideNavItem
              label="Customers"
              href="/customers"
              icon={ContactRound}
              isSelected={isActive("/customers")}
            />
            <SideNavItem
              label="Conversations"
              href="/conversations"
              icon={MessageSquareText}
              isSelected={isActive("/conversations")}
            />
            <SideNavItem
              label="Tasks"
              href="/tasks"
              icon={ClipboardList}
              isSelected={isActive("/tasks")}
            />
            <SideNavItem
              label="Agents"
              href="/agents"
              icon={Bot}
              isSelected={isActive("/agents")}
            />
            <SideNavItem
              label="Analytics"
              href="/analytics"
              icon={ChartNoAxesCombined}
              isSelected={isActive("/analytics")}
            />
          </SideNavSection>
          <SideNavSection title="System">
            <SideNavItem
              label="Operations"
              icon={Workflow}
              isSelected={operationsActive}
              collapsible={{ defaultIsCollapsed: !operationsActive }}
            >
              <SideNavItem
                label="Live operations"
                href="/operations/live-operations"
                icon={Activity}
                isSelected={isActive("/operations/live-operations")}
              />
              <SideNavItem
                label="Imports"
                href="/operations/imports"
                isSelected={isActive("/operations/imports")}
              />
              <SideNavItem
                label="Campaign runs"
                href="/operations/campaigns"
                isSelected={isActive("/operations/campaigns")}
              />
              <SideNavItem
                label="Deliveries"
                href="/operations/deliveries"
                isSelected={isActive("/operations/deliveries")}
              />
              <SideNavItem
                label="Integrations"
                href="/operations/integrations"
                isSelected={isActive("/operations/integrations")}
              />
              <SideNavItem
                label="Audit"
                href="/operations/audit"
                isSelected={isActive("/operations/audit")}
              />
            </SideNavItem>
            <SideNavItem
              label="Settings"
              href="/settings"
              icon={Settings}
              isSelected={isActive("/settings")}
            />
          </SideNavSection>
        </SideNav>
      }
    >
      <Layout
        height="auto"
        contentWidth={1120}
        content={
          <LayoutContent padding={8} isScrollable={false}>
            <WorkspaceGate>{children}</WorkspaceGate>
          </LayoutContent>
        }
      />
    </AppShell>
  );
}
