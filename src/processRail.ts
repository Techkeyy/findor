export type ProcessRailStatus =
  | "needs_info"
  | "brief_ready"
  | "brief_approved"
  | "researching"
  | "providers_ready"
  | "outreach_approved"
  | "outreach_sent"
  | "reply_received"
  | "reply_understood"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed"
  | "needs_user";

export type ProcessRailJob = {
  status?: ProcessRailStatus;
  executionStatus?: "active" | "paused" | "cancelled" | "completed";
  briefApprovedAt?: number;
  pausedFromStatus?: ProcessRailStatus;
  autonomy?: { approvedAt?: number; enabled?: boolean };
};

export type ProcessRailStep = {
  label: string;
  complete: boolean;
};

export function getProcessRailSteps(
  job?: ProcessRailJob | null,
): ProcessRailStep[] {
  const isPaused =
    job?.executionStatus === "paused" ||
    job?.status === "paused" ||
    Boolean(job?.pausedFromStatus);
  const status = job?.status ?? "needs_info";
  const effectiveStatus = isPaused
    ? (job?.pausedFromStatus ??
      (job?.briefApprovedAt ? "brief_approved" : status === "paused" ? "needs_info" : status))
    : status;

  const isIntakeOrReview = ["needs_info", "brief_ready"].includes(
    effectiveStatus,
  );
  const mandateApproved =
    !isIntakeOrReview &&
    Boolean(job?.briefApprovedAt ?? job?.autonomy?.approvedAt);

  const providerWorkStatuses: ProcessRailStatus[] = [
    "researching",
    "providers_ready",
    "outreach_approved",
    "outreach_sent",
    "reply_received",
    "reply_understood",
    "needs_user",
    "completed",
  ];
  const providerWorkStarted =
    !isIntakeOrReview && providerWorkStatuses.includes(effectiveStatus);

  return [
    { label: "Describe the service", complete: true },
    {
      label: "Review the brief",
      complete: !isIntakeOrReview,
    },
    {
      label: "Approve Findor's mandate",
      complete: mandateApproved,
    },
    {
      label: "Findor researches and contacts eligible providers",
      complete: mandateApproved && providerWorkStarted,
    },
    {
      label: "Review replies and options",
      complete: ["reply_received", "reply_understood", "completed"].includes(
        effectiveStatus,
      ),
    },
  ];
}