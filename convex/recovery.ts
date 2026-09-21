export type ProviderResolution =
  | "waiting"
  | "replied"
  | "declined"
  | "delivery_failed"
  | "no_response"
  | "send_failed"
  | "paused"
  | "cancelled"
  | "needs_user";

export type RecoveryMessage = {
  providerKey: string;
  status: "approved" | "sending" | "sent" | "delivery_failed" | "failed";
  purpose?: "initial" | "routine_clarification" | "follow_up";
  providerResolution?: ProviderResolution;
  usableResponse?: boolean;
};

export type ProviderResolutionCounts = {
  contactedCount: number;
  waitingCount: number;
  repliedCount: number;
  declinedCount: number;
  deliveryFailedCount: number;
  noResponseCount: number;
  sendFailedCount: number;
  usableResponseCount: number;
  remainingProviderCapacity: number;
};

export type JobResolutionDecision =
  | "wait"
  | "continue_autonomy"
  | "needs_user"
  | "options_ready";

export function summarizeProviderResolution(
  messages: RecoveryMessage[],
  maxProviders: number,
): ProviderResolutionCounts {
  const byProvider = new Map<string, RecoveryMessage[]>();
  for (const message of messages) {
    if (message.purpose && message.purpose !== "initial") continue;
    const rows = byProvider.get(message.providerKey) ?? [];
    rows.push(message);
    byProvider.set(message.providerKey, rows);
  }

  let contactedCount = 0;
  let waitingCount = 0;
  let repliedCount = 0;
  let declinedCount = 0;
  let deliveryFailedCount = 0;
  let noResponseCount = 0;
  let sendFailedCount = 0;
  let usableResponseCount = 0;

  for (const rows of byProvider.values()) {
    if (rows.some((row) => row.status !== "failed")) contactedCount += 1;
    const state = rows.find((row) => row.providerResolution)?.providerResolution;
    const effectiveState = state ??
      (rows.some((row) => row.status === "sent") ? "waiting" : "send_failed");
    if (effectiveState === "waiting") waitingCount += 1;
    if (effectiveState === "replied") repliedCount += 1;
    if (effectiveState === "declined") declinedCount += 1;
    if (effectiveState === "delivery_failed") deliveryFailedCount += 1;
    if (effectiveState === "no_response") noResponseCount += 1;
    if (effectiveState === "send_failed") sendFailedCount += 1;
    if (rows.some((row) => row.usableResponse)) usableResponseCount += 1;
  }

  return {
    contactedCount,
    waitingCount,
    repliedCount,
    declinedCount,
    deliveryFailedCount,
    noResponseCount,
    sendFailedCount,
    usableResponseCount,
    remainingProviderCapacity: Math.max(0, Math.floor(maxProviders) - contactedCount),
  };
}

export function decideJobResolution(
  counts: ProviderResolutionCounts,
): JobResolutionDecision {
  if (counts.waitingCount > 0) return "wait";
  if (counts.sendFailedCount > 0) return "needs_user";
  if (counts.usableResponseCount > 0) return "options_ready";
  if (counts.remainingProviderCapacity > 0) return "continue_autonomy";
  return "needs_user";
}
