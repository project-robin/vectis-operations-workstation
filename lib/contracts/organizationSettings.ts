export type AttributionWindow = {
  value: number;
  unit: "hours" | "days";
  semantics: "interaction_to_outcome";
};

export type ExpectedBookingValuePolicy =
  | { mode: "none" | "opportunity"; amountMinor?: never; currency?: never; serviceValues?: never }
  | { mode: "org_wide"; amountMinor: number; currency: string; serviceValues?: never }
  | {
      mode: "service";
      serviceValues: Array<{ service: string; amountMinor: number; currency: string }>;
      amountMinor?: never;
      currency?: never;
    };

export type HealthFreshnessPolicy = {
  warningAfterMinutes: number;
  criticalAfterMinutes: number;
};

export type CommercialMetricsMode = "shadow" | "published";
export type BookingAuthorityPolicy = { sourceType: string; requireReadback: boolean };
export type PaymentAuthorityPolicy = { sourceTypes: string[]; requireReadback: boolean };
export type RecoveryPolicy = {
  enabled: boolean;
  window: { value: number; unit: "hours" | "days" };
  priorStateTypes: Array<"missed" | "stale" | "no_show" | "overdue">;
};

export type OrganizationPolicy = {
  timezone: string;
  defaultCurrency: string;
  attributionWindow: AttributionWindow;
  businessVertical?: string;
  expectedBookingValuePolicy: ExpectedBookingValuePolicy;
  commercialMetricsMode: CommercialMetricsMode;
  bookingAuthorityPolicy: BookingAuthorityPolicy;
  paymentAuthorityPolicy: PaymentAuthorityPolicy;
  recoveryPolicy: RecoveryPolicy;
  healthFreshnessPolicy: HealthFreshnessPolicy;
};

export type OrganizationSettings = OrganizationPolicy & {
  _id?: string;
  organizationId?: string;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
};
