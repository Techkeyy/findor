const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function tryNormalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeEmail(value: unknown): string {
  const normalized = tryNormalizeEmail(value);
  if (!normalized) {
    throw new Error("Invalid email");
  }
  return normalized;
}

export function generateNumericVerificationCode(length = 8): string {
  const digits = "0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += digits[bytes[i] % 10];
  }
  return code;
}

export async function computeResetIdempotencyKey(
  email: string,
  token: string,
): Promise<string> {
  const data = new TextEncoder().encode(`findor-pwd-reset:${email}:${token}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pwd-reset-${hashHex.slice(0, 32)}`;
}
