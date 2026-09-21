export type AuthErrorCode =
  | "INVALID_EMAIL"
  | "PASSWORD_TOO_SHORT"
  | "ACCOUNT_EXISTS"
  | "INVALID_CREDENTIALS"
  | "RESET_CODE_INVALID"
  | "RESET_CODE_EXPIRED"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export type AuthField = "email" | "password" | "code" | "newPassword" | "general";

export interface NormalizedAuthError {
  code: AuthErrorCode;
  message: string;
  field: AuthField;
  referenceId?: string;
  rawForLogs?: string;
}

/**
 * Masks an email for user-facing success / security confirmations.
 * e.g. "iszeekills@gmail.com" -> "i***s@gmail.com" or "user@domain.com" -> "u***r@domain.com"
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 1) return trimmed;
  const username = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  if (username.length <= 2) {
    return `${username[0]}*${domain}`;
  }
  return `${username[0]}***${username[username.length - 1]}${domain}`;
}

/**
 * Extracts a neutral reference identifier if present (e.g. from Convex Request ID)
 * without leaking raw server paths or stack frames.
 */
function extractReferenceId(raw: string): string | undefined {
  const match = /\[Request ID:\s*([a-zA-Z0-9_-]+)\]/i.exec(raw);
  if (match && match[1]) {
    // Take first 8 chars uppercase as a clean neutral reference
    return match[1].slice(0, 8).toUpperCase();
  }
  return undefined;
}

/**
 * Strips raw internal Convex / JS runtime prefixes and stack details from a message string.
 */
function cleanRawMessage(raw: string): string {
  return raw
    .replace(/\[CONVEX\s+[^\]]+\]/gi, "")
    .replace(/\[Request ID:\s*[^\]]+\]/gi, "")
    .replace(/Called by client/gi, "")
    .replace(/Server Error/gi, "")
    .replace(/Uncaught (?:Convex)?Error:\s*/gi, "")
    .replace(/^\s*at\s+.*$/gm, "")
    .trim();
}

/**
 * Central auth error normalization layer.
 * Converts Convex errors, network errors, and auth provider exceptions into
 * unambiguous, consumer-friendly feedback while strictly hiding internal implementation details.
 */
export function normalizeAuthError(
  error: unknown,
  flow?: "signIn" | "signUp" | "reset" | "reset-verification",
): NormalizedAuthError {
  let rawMessage = "";
  if (error instanceof Error) {
    rawMessage = error.message;
  } else if (typeof error === "string") {
    rawMessage = error;
  } else if (error && typeof error === "object" && "message" in error) {
    const msg = error.message;
    rawMessage = typeof msg === "string" ? msg : typeof msg === "number" || typeof msg === "boolean" ? String(msg) : "";
  } else if (typeof error === "number" || typeof error === "boolean") {
    rawMessage = String(error);
  }

  let errorData = "";
  if (error && typeof error === "object" && "data" in error) {
    const dataVal = error.data;
    if (typeof dataVal === "string") {
      errorData = dataVal;
    } else if (typeof dataVal === "object" && dataVal !== null) {
      try {
        errorData = JSON.stringify(dataVal);
      } catch {
        errorData = "";
      }
    } else if (typeof dataVal === "number" || typeof dataVal === "boolean") {
      errorData = String(dataVal);
    }
  }

  const combinedRaw = errorData ? `${rawMessage} ${errorData}` : rawMessage;
  const referenceId = extractReferenceId(combinedRaw);
  const cleaned = cleanRawMessage(combinedRaw).toLowerCase();

  // 1. Network / Connection errors
  if (
    cleaned.includes("failed to fetch") ||
    cleaned.includes("networkerror") ||
    cleaned.includes("network request failed") ||
    cleaned.includes("load failed") ||
    cleaned.includes("timeout") ||
    cleaned.includes("connection refused") ||
    cleaned.includes("abort") ||
    cleaned.includes("offline")
  ) {
    return {
      code: "NETWORK_ERROR",
      message: "We couldn't reach Findor. Check your connection and try again.",
      field: "general",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 2. Email formatting / validity issues
  if (
    cleaned.includes("invalid email") ||
    cleaned.includes("enter a valid email") ||
    cleaned.includes("malformed email") ||
    cleaned.includes("email is required") ||
    cleaned.includes("invalid identifier")
  ) {
    return {
      code: "INVALID_EMAIL",
      message: "Enter a valid email address.",
      field: "email",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 3. Existing account conflicts
  if (
    cleaned.includes("already exists") ||
    cleaned.includes("account_exists") ||
    cleaned.includes("user already exists") ||
    cleaned.includes("duplicate account")
  ) {
    return {
      code: "ACCOUNT_EXISTS",
      message: "An account with this email already exists. Sign in instead.",
      field: "email",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 4. Password requirement / length issues
  if (
    cleaned.includes("password must be at least") ||
    cleaned.includes("invalid password") ||
    cleaned.includes("password is required") ||
    cleaned.includes("missing `password` param") ||
    cleaned.includes("password_too_short") ||
    cleaned.includes("password too short")
  ) {
    return {
      code: "PASSWORD_TOO_SHORT",
      message: "Use a password with at least 8 characters.",
      field: flow === "reset-verification" ? "newPassword" : "password",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 5. Verification code expired
  if (
    cleaned.includes("expired") ||
    cleaned.includes("token expired") ||
    cleaned.includes("code expired")
  ) {
    return {
      code: "RESET_CODE_EXPIRED",
      message: "That verification code has expired. Request a new one.",
      field: "code",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 6. Verification code invalid
  if (
    cleaned.includes("invalid code") ||
    cleaned.includes("invalid verification code") ||
    cleaned.includes("incorrect code") ||
    cleaned.includes("verification code is incorrect")
  ) {
    return {
      code: "RESET_CODE_INVALID",
      message: "That verification code is incorrect. Check the code and try again.",
      field: "code",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 7. Invalid credentials (wrong password / secret)
  if (
    cleaned.includes("invalid credentials") ||
    cleaned.includes("invalidsecret") ||
    cleaned.includes("invalidaccountid") ||
    cleaned.includes("could not verify password") ||
    cleaned.includes("incorrect password") ||
    cleaned.includes("wrong password") ||
    cleaned.includes("invalid login")
  ) {
    return {
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
      field: "general",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 8. Rate limiting
  if (
    cleaned.includes("toomanyfailedattempts") ||
    cleaned.includes("too many sign-in attempts") ||
    cleaned.includes("too many attempts") ||
    cleaned.includes("rate limit")
  ) {
    return {
      code: "RATE_LIMIT",
      message: "Too many attempts. Please try again shortly.",
      field: "general",
      referenceId,
      rawForLogs: combinedRaw,
    };
  }

  // 9. Unknown / Unhandled fallback
  return {
    code: "UNKNOWN",
    message: "We couldn't complete that request right now. Please try again.",
    field: "general",
    referenceId,
    rawForLogs: combinedRaw,
  };
}
