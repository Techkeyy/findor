import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import {
  ConvexCredentials,
  type ConvexCredentialsUserConfig,
} from "@convex-dev/auth/providers/ConvexCredentials";
import { ConvexError } from "convex/values";
import { env } from "./_generated/server";
import {
  normalizeEmail,
  generateNumericVerificationCode,
} from "./authShared";

const resetEmail = Email({
  id: "password-reset",
  maxAge: 15 * 60, // 15 minutes
  generateVerificationToken: async () => generateNumericVerificationCode(8),
  async sendVerificationRequest({ identifier: email, token }) {
    (globalThis as Record<string, unknown>).__lastResetCode = { email, token };
    const apiKey = env.AGENTMAIL_API_KEY;
    const inboxId =
      (env as Record<string, string | undefined>).AUTH_RESET_INBOX_ID ||
      env.AGENTMAIL_INBOX_ID;

    const hasApiKey = Boolean(apiKey);
    const hasInboxId = Boolean(inboxId);
    const isRecipientValid =
      typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!apiKey || !inboxId) {
      console.error(
        JSON.stringify({
          stage: "auth_reset_agentmail_send_aborted",
          status: null,
          inboxConfigured: hasInboxId,
          apiKeyConfigured: hasApiKey,
          recipientValid: isRecipientValid,
          errorCode: "MISSING_ENV_CONFIG",
          errorMessage: "AgentMail is not configured on this Convex deployment",
        }),
      );
      return;
    }

    try {
      const response = await fetch(
        `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: [email],
            subject: "Your Findor Password Reset Code",
            text: `Your Findor password reset verification code is:\n\n${token}\n\nThis code will expire in 15 minutes. If you did not request this, you can safely ignore this email.`,
            html: `<p>Hello,</p><p>Your Findor password reset verification code is:</p><p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; font-family: monospace;">${token}</p><p>This code will expire in 15 minutes. If you did not request this, you can safely ignore this email.</p><p>&mdash; Findor Security</p>`,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let parsedJson: Record<string, unknown> | null = null;
        try {
          parsedJson = JSON.parse(errorText) as Record<string, unknown>;
        } catch {
          // non-json response
        }

        const errorCode =
          parsedJson && typeof parsedJson.error === "string"
            ? parsedJson.error
            : parsedJson && typeof parsedJson.code === "string"
              ? parsedJson.code
              : `HTTP_${response.status}`;

        const rawMessage =
          parsedJson && typeof parsedJson.message === "string"
            ? parsedJson.message
            : errorText.slice(0, 200);

        const sanitizedMessage = rawMessage.replace(
          /[a-zA-Z0-9_-]{24,}/g,
          "[REDACTED]",
        );

        console.error(
          JSON.stringify({
            stage: "auth_reset_agentmail_send_failed",
            status: response.status,
            inboxConfigured: hasInboxId,
            apiKeyConfigured: hasApiKey,
            recipientValid: isRecipientValid,
            isJsonBody: parsedJson !== null,
            errorCode,
            errorMessage: sanitizedMessage,
          }),
        );
        throw new Error("Failed to send password reset email.");
      }

      const payload: unknown = await response.json().catch(() => null);
      const record =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : null;
      const messageId =
        record && typeof record.message_id === "string"
          ? record.message_id
          : "";
      const threadId =
        record && typeof record.thread_id === "string"
          ? record.thread_id
          : "";

      console.log(
        JSON.stringify({
          stage: "auth_reset_agentmail_send_success",
          status: response.status,
          inboxConfigured: hasInboxId,
          apiKeyConfigured: hasApiKey,
          recipientValid: isRecipientValid,
          hasMessageId: Boolean(messageId),
          hasThreadId: Boolean(threadId),
        }),
      );
    } catch (sendError) {
      if (
        sendError instanceof Error &&
        sendError.message === "Failed to send password reset email."
      ) {
        throw sendError;
      }
      const rawError =
        sendError instanceof Error ? sendError.message : String(sendError);
      console.error(
        JSON.stringify({
          stage: "auth_reset_agentmail_network_error",
          status: null,
          inboxConfigured: hasInboxId,
          apiKeyConfigured: hasApiKey,
          recipientValid: isRecipientValid,
          errorCode: "FETCH_EXCEPTION",
          errorMessage: rawError
            .replace(/[a-zA-Z0-9_-]{24,}/g, "[REDACTED]")
            .slice(0, 200),
        }),
      );
      throw new Error("Failed to send password reset email.");
    }
  },
});

const basePassword = Password({
  profile: (params) => ({
    email: normalizeEmail(params.email),
  }),
  reset: resetEmail,
});
const basePasswordOptions = (
  basePassword as unknown as { options: ConvexCredentialsUserConfig }
).options;

const password = ConvexCredentials({
  id: "password",
  crypto: basePasswordOptions.crypto,
  extraProviders: basePasswordOptions.extraProviders,
  authorize: async (params, ctx) => {
    try {
      if (params.flow === "reset") {
        try {
          return await basePasswordOptions.authorize(params, ctx);
        } catch (resetError) {
          const resetMsg = resetError instanceof Error ? resetError.message : "";
          if (
            resetMsg === "InvalidAccountId" ||
            resetMsg === "Invalid credentials" ||
            resetMsg.includes("InvalidAccountId")
          ) {
            // Enumeration safety: absorb missing account during reset request
            return null;
          }
          throw resetError;
        }
      }
      return await basePasswordOptions.authorize(params, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message === "InvalidSecret" ||
        message === "InvalidAccountId" ||
        message === "Invalid credentials"
      ) {
        throw new ConvexError("Invalid credentials");
      }
      if (message.includes("already exists")) {
        throw new ConvexError("An account with this email already exists. Sign in instead.");
      }
      if (message === "Invalid code" || message.includes("Invalid code")) {
        throw new ConvexError("Invalid verification code");
      }
      if (message === "Invalid password" || message.includes("Invalid password")) {
        throw new ConvexError("Password must be at least 8 characters.");
      }
      if (message === "TooManyFailedAttempts") {
        throw new ConvexError("Too many sign-in attempts. Try again later.");
      }
      if (message.includes("Missing `password` param")) {
        throw new ConvexError("Password is required.");
      }
      throw error;
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [password],
});
