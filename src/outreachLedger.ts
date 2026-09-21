export type OutreachLedgerMessage = {
  _id: string;
  candidateId: string;
  cycleId?: string;
  providerEmail: string;
  status: string;
  purpose?: string;
  externalMessageId?: string;
  externalThreadId?: string;
  failureReason?: string;
  providerResolution?: string;
  followUpState?: string;
  nextFollowUpAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type OutreachLedgerCandidate = {
  _id: string;
  name: string;
};

export type OutreachLedgerRow = {
  message: OutreachLedgerMessage;
  providerName: string;
  contactRoute: string;
  sendState: string;
  providerState: string;
  followUpState: string;
  receiptPresent: boolean;
};

export type OutreachHistoryEvent = {
  _id: string;
  eventType: string;
  message: string;
  createdAt: number;
};

function isInitial(message?: OutreachLedgerMessage | null) {
  if (!message) return false;
  return !message.purpose || message.purpose === "initial";
}

export function sendStateLabel(status?: string | null) {
  switch (status) {
    case "sending":
      return "Sending";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "delivery_failed":
      return "Delivery failed";
    case "approved":
      return "Queued";
    default:
      return status ?? "Pending";
  }
}

export function followUpStateLabel(state?: string | null) {
  switch (state) {
    case "scheduling":
    case "scheduled":
      return "Planned";
    case "cancelled":
      return "Cancelled";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "due":
      return "Due for recheck";
    default:
      return "Not planned";
  }
}

export function providerStateLabel(state?: string | null) {
  switch (state) {
    case "waiting":
      return "Waiting for reply";
    case "replied":
      return "Provider replied";
    case "declined":
      return "Provider declined";
    case "delivery_failed":
      return "Delivery failed";
    case "no_response":
      return "No response";
    case "send_failed":
      return "Send failed";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
    case "needs_user":
      return "Needs your review";
    default:
      return "Not started";
  }
}

export function buildOutreachLedgerRows(
  messages?: OutreachLedgerMessage[] | null,
  candidates?: OutreachLedgerCandidate[] | null,
): OutreachLedgerRow[] {
  if (!messages || !Array.isArray(messages)) return [];
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const names = new Map(
    candidateList
      .filter((c): c is OutreachLedgerCandidate => Boolean(c && c._id))
      .map((candidate) => [candidate._id, candidate.name ?? "Provider"]),
  );
  return messages
    .filter(isInitial)
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
    .map((message) => ({
      message,
      providerName: names.get(message.candidateId) ?? "Provider",
      contactRoute: message.providerEmail ?? "Email",
      sendState: sendStateLabel(message.status),
      providerState: providerStateLabel(
        message.providerResolution ??
          (message.status === "sent" ? "waiting" : undefined),
      ),
      followUpState: followUpStateLabel(message.followUpState),
      receiptPresent: Boolean(message.externalMessageId && message.externalThreadId),
    }));
}

function providerForEvent(
  event?: OutreachHistoryEvent | null,
  messages?: OutreachLedgerMessage[] | null,
  candidates?: OutreachLedgerCandidate[] | null,
) {
  if (!event || !event.eventType) return undefined;
  const providerEvents = new Set([
    "outreach_sent",
    "outreach_failed",
    "follow_up_scheduled",
    "follow_up_sent",
    "follow_up_failed",
  ]);
  if (!providerEvents.has(event.eventType)) return undefined;
  if (!messages || !Array.isArray(messages) || messages.length === 0) return undefined;
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) return undefined;

  const eventTime = event.createdAt ?? 0;
  const eligible =
    event.eventType === "follow_up_scheduled"
      ? messages.filter(isInitial)
      : messages;
  if (eligible.length === 0) return undefined;

  const closest = eligible
    .map((message) => ({
      message,
      distance: Math.abs(
        (message.updatedAt ?? message.createdAt ?? 0) - eventTime,
      ),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!closest || closest.distance > 120_000) return undefined;

  return candidates.find((candidate) => candidate._id === closest.message.candidateId)?.name;
}

export function providerEventMessage(
  event: OutreachHistoryEvent,
  messages?: OutreachLedgerMessage[] | null,
  candidates?: OutreachLedgerCandidate[] | null,
) {
  if (!event) return "";
  const providerName = providerForEvent(event, messages, candidates);
  if (!providerName) return event.message ?? "";

  switch (event.eventType) {
    case "outreach_sent":
      return `AgentMail accepted outreach to ${providerName}.`;
    case "outreach_failed":
      return `AgentMail did not return a successful receipt for ${providerName}.`;
    case "follow_up_scheduled":
      return `Follow-up planned for ${providerName}.`;
    case "follow_up_sent":
      return `AgentMail accepted the bounded follow-up to ${providerName}.`;
    case "follow_up_failed":
      return `The bounded follow-up to ${providerName} failed.`;
    default:
      return event.message ?? "";
  }
}

/**
 * Truthful "providers contacted" count for the waiting screen and ledgers.
 *
 * Counts distinct successfully-sent INITIAL outreach rows across the whole
 * job history. Excludes failed sends, follow-ups (same provider, not a new
 * contact), and duplicate rows.
 */
export function countContactedProviders(
  messages?: Array<{
    _id: string;
    candidateId?: string | null;
    cycleId?: string | null;
    status?: string;
    purpose?: string;
  }> | null,
): number {
  if (!messages || !Array.isArray(messages)) return 0;
  const seen = new Set<string>();
  for (const message of messages) {
    if (!message || message.status !== "sent") continue;
    if (message.purpose && message.purpose !== "initial") continue;
    seen.add(
      message.candidateId != null
        ? `cand:${message.candidateId}`
        : `msg:${message._id}`,
    );
  }
  return seen.size;
}

/** Count distinct successful initial contacts in one cycle for round copy. */
export function countContactedProvidersInCycle(
  messages?: Array<{
    _id: string;
    candidateId?: string | null;
    cycleId?: string | null;
    status?: string;
    purpose?: string;
  }> | null,
  currentCycleId?: string | null,
): number {
  if (!messages || !Array.isArray(messages) || !currentCycleId) return 0;
  return countContactedProviders(
    messages.filter((message) => message.cycleId === currentCycleId),
  );
}
