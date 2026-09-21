export function friendlyIntakeError(
  error: unknown,
  mode: "create" | "update",
) {
  const rawMessage = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    rawMessage.includes("sign in") ||
    rawMessage.includes("signed in") ||
    rawMessage.includes("session")
  ) {
    return "Your session may have expired. Please sign in again and try again.";
  }
  if (
    rawMessage.includes("country") ||
    rawMessage.includes("region") ||
    rawMessage.includes("city") ||
    rawMessage.includes("timing") ||
    rawMessage.includes("description") ||
    rawMessage.includes("required") ||
    rawMessage.includes("valid")
  ) {
    return "We couldn't create your job brief. Please check the highlighted fields and try again.";
  }
  return mode === "create"
    ? "We couldn't create your job brief. Please check the highlighted fields and try again."
    : "We couldn't update your job brief. Please check the highlighted fields and try again.";
}
