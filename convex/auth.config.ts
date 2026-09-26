const issuerDomain = process.env.CLERK_ISSUER_DOMAIN;
if (!issuerDomain) {
  throw new Error("CLERK_ISSUER_DOMAIN is required in the Convex deployment environment");
}

export default {
  providers: [
    {
      domain: issuerDomain,
      // Must match the `aud` claim of the Clerk JWT template named "convex".
      applicationID: "convex",
    },
  ],
};
