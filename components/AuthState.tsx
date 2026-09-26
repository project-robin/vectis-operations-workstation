"use client";

import { useConvexAuth } from "convex/react";

function AuthenticatedState() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return <p role="status">Checking auth…</p>;
  }
  return (
    <p role="status">
      {isAuthenticated ? "Convex auth: authenticated" : "Convex auth: signed out"}
    </p>
  );
}

export function AuthState() {
  return <AuthenticatedState />;
}
