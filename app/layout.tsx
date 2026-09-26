import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/providers/ConvexClientProvider";
import { VectisThemeProvider } from "@/components/providers/VectisThemeProvider";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vectis — AI Receptionist",
  description:
    "Call your leads and customers with an AI voice agent and see every result in one place.",
};

/** Clerk publishable keys encode the Frontend API host as base64("host$"). */
function clerkFrontendApiOrigin(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.split("_")[2];
  if (!key) return null;
  const host = Buffer.from(key, "base64").toString("utf8").replace(/\$$/, "");
  return host ? `https://${host}` : null;
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // Every page load waits on Clerk then Convex before the workspace renders;
  // warm both connections while the JS bundle is still downloading.
  const clerkOrigin = clerkFrontendApiOrigin();
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {clerkOrigin ? <link rel="preconnect" href={clerkOrigin} /> : null}
          {convexUrl ? <link rel="preconnect" href={convexUrl} /> : null}
        </head>
        <body>
          <ConvexClientProvider>
            <VectisThemeProvider>{children}</VectisThemeProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
