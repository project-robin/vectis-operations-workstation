"use client";

import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";

/** Waits for Clerk -> Convex auth, provisions the personal workspace once, then renders the app. */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const workspace = useQuery(api.workspace.current, isAuthenticated ? {} : "skip");
  const ensureWorkspace = useMutation(api.workspace.ensureWorkspace);
  const requested = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || workspace !== null || requested.current) return;
    requested.current = true;
    ensureWorkspace({}).catch((reason: unknown) => {
      requested.current = false;
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [isAuthenticated, workspace, ensureWorkspace]);

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        Could not open your workspace: {error}
      </div>
    );
  }
  if (isLoading || (isAuthenticated && !workspace)) {
    return (
      <VStack gap={8} role="status">
        <VStack gap={3}>
          <Skeleton width="35%" height="var(--font-size-3xl)" />
          <Skeleton width="55%" height="var(--font-size-base)" index={1} />
        </VStack>
        <Skeleton height="var(--spacing-10)" index={2} />
        <Skeleton height="var(--spacing-10)" index={3} />
        <Text color="secondary">Loading your workspace…</Text>
      </VStack>
    );
  }
  if (!isAuthenticated) {
    return (
      <div className="notice" role="status">
        Signing you in… If this does not finish, <a href="/sign-in">sign in again</a>.
      </div>
    );
  }
  return <>{children}</>;
}
