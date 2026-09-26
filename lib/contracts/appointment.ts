export const APPOINTMENT_STATUSES = ["requested", "confirmed", "cancelled", "no_show", "completed"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  requested: ["requested", "confirmed", "cancelled"],
  confirmed: ["confirmed", "cancelled", "no_show", "completed"],
  cancelled: ["cancelled"],
  no_show: ["no_show"],
  completed: ["completed"],
};

export function assertAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!APPOINTMENT_TRANSITIONS[from]?.includes(to)) throw new Error(`Illegal appointment transition: ${from} -> ${to}`);
}

export function assertAuthoritativeReadback(externalId: string | undefined, evidence: string | undefined): asserts externalId is string {
  if (!externalId || externalId.trim().length === 0) throw new Error("Confirmation requires an authoritative external id");
  if (!evidence || evidence.trim().length === 0 || !evidence.includes(externalId)) throw new Error("Confirmation requires exact read-back evidence");
}
