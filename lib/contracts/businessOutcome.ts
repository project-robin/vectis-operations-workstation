export const BUSINESS_OUTCOME_VERSION = 1;
export const OUTCOME_VERSION = BUSINESS_OUTCOME_VERSION;

export type BusinessOutcomeType =
  | "no_outcome"
  | "reached"
  | "qualified"
  | "booking_requested"
  | "human_handoff_requested"
  | "quote_requested"
  | "payment_promised"
  | "dispute"
  | "follow_up_required";
export type OutcomeType = BusinessOutcomeType;

export type BusinessOutcomeFields = {
  resolution?: string;
  reached?: boolean;
  qualified?: boolean;
  bookingRequested?: boolean;
  /** Always false for provider-derived call evidence; confirmation is a separate authoritative write. */
  bookingConfirmed: false;
  handoffRequested?: boolean;
  quoteRequested?: boolean;
  paymentPromise?: boolean;
  dispute?: boolean;
  followUpRequired?: boolean;
  sentiment?: string;
  summary?: string;
};

export type BusinessOutcomeCustomField = { key: string; value: string };

export type NormalizedBusinessOutcome = {
  version: typeof BUSINESS_OUTCOME_VERSION;
  outcomeType: BusinessOutcomeType;
  fields: BusinessOutcomeFields;
  customFields: BusinessOutcomeCustomField[];
};
export type NormalizedOutcome = NormalizedBusinessOutcome;
