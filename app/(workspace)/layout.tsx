import type { ReactNode } from "react";
import { WorkstationShell } from "@/components/WorkstationShell";

// One shell for every workspace route, so the sidebar and workspace gate stay
// mounted across client-side navigation instead of remounting per page.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkstationShell>{children}</WorkstationShell>;
}
