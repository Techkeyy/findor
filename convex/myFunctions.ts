import { getAuthUserId } from "@convex-dev/auth/server";
import { query, internalQuery, internalAction, env } from "./_generated/server";
import { v } from "convex/values";
import { tryNormalizeEmail } from "./authShared";

export const currentUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("users"),
      email: v.union(v.string(), v.null()),
      name: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get("users", userId);
    if (!user) {
      return null;
    }

    return {
      id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
    };
  },
});

export const accountExistsForEmail = query({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = tryNormalizeEmail(args.email);
    if (!email) {
      return false;
    }

    const users = await ctx.db
      .query("users")
      .withIndex("email", (query) => query.eq("email", email))
      .take(1);
    return users.length > 0;
  },
});

export const inspectJobAudit = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const cycles = await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .collect();
    const briefVersions = await ctx.db
      .query("briefVersions")
      .withIndex("by_job_and_version", (q) => q.eq("jobId", args.jobId))
      .collect();
    const events = await ctx.db
      .query("jobEvents")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .collect();
    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .collect();
    const outreach = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .collect();
    return {
      job,
      cycles,
      briefVersions,
      events,
      candidates,
      outreach,
    };
  },
});

export const internalAuditAuth = internalQuery({
  args: { email: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    const accounts = await ctx.db.query("authAccounts").collect();
    const sessions = await ctx.db.query("authSessions").collect();
    const rateLimits = await ctx.db.query("authRateLimits").collect();
    const jobs = await ctx.db.query("jobs").collect();

    return {
      users: users.map((u) => ({
        id: u._id,
        email: u.email,
        name: u.name,
        creationTime: u._creationTime,
        jobsOwned: jobs.filter((j) => j.ownerId === u._id).length,
      })),
      accounts: accounts.map((a) => ({
        id: a._id,
        userId: a.userId,
        provider: a.provider,
        providerAccountId: a.providerAccountId,
        hasSecret: Boolean(a.secret),
        creationTime: a._creationTime,
      })),
      rateLimits: rateLimits.map((r) => ({
        id: r._id,
        identifier: r.identifier,
        attemptsLeft: r.attemptsLeft,
        lastAttemptTime: r.lastAttemptTime,
      })),
      sessionsCount: sessions.length,
      verificationCodesCount: (await ctx.db.query("authVerificationCodes").collect()).length,
      verificationCodes: (await ctx.db.query("authVerificationCodes").collect()).map((c) => ({
        id: c._id,
        provider: c.provider,
        hasAccountId: Boolean(c.accountId),
        hasExpiration: Boolean(c.expirationTime),
        isExpired: c.expirationTime ? c.expirationTime < Date.now() : null,
        creationTime: c._creationTime,
      })),
      queryEmailArg: args.email,
    };
  },
});

export const internalAuditAgentMail = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const hasApiKey = Boolean(env.AGENTMAIL_API_KEY);
    const configuredInboxId = env.AGENTMAIL_INBOX_ID ?? null;
    const authResetInboxId = (env as Record<string, string | undefined>).AUTH_RESET_INBOX_ID ?? null;
    const targetInbox = authResetInboxId || configuredInboxId;
    let listStatus: number | null = null;
    let inboxes: Array<{ id: string; address?: string; name?: string; keys?: string[] }> = [];
    let listError: string | null = null;
    let singleInboxStatus: number | null = null;
    let singleInboxDetails: Record<string, unknown> | null = null;
    let messagesStatus: number | null = null;
    let recentMessages: Array<Record<string, unknown>> = [];

    if (env.AGENTMAIL_API_KEY) {
      try {
        const res = await fetch("https://api.agentmail.to/v0/inboxes", {
          headers: {
            Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
          },
        });
        listStatus = res.status;
        if (res.ok) {
          const data = (await res.json()) as { inboxes?: Array<Record<string, unknown>> };
          inboxes = (data.inboxes ?? []).map((ib) => {
            const rawId =
              typeof ib.inbox_id === "string"
                ? ib.inbox_id
                : typeof ib.id === "string"
                  ? ib.id
                  : "";
            const rawAddress =
              typeof ib.address === "string"
                ? ib.address
                : typeof ib.email === "string"
                  ? ib.email
                  : "";
            return {
              id: rawId,
              address: rawAddress,
              name: typeof ib.name === "string" ? ib.name : undefined,
              keys: Object.keys(ib),
            };
          });
        } else {
          listError = await res.text().catch(() => "");
        }
      } catch (err) {
        listError = err instanceof Error ? err.message : String(err);
      }

      if (targetInbox) {
        try {
          const singleRes = await fetch(
            `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(targetInbox)}`,
            {
              headers: {
                Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
              },
            },
          );
          singleInboxStatus = singleRes.status;
          if (singleRes.ok) {
            const singleData = (await singleRes.json()) as Record<string, unknown>;
            singleInboxDetails = {
              keys: Object.keys(singleData),
              inbox_id: singleData.inbox_id,
              email: singleData.email,
              display_name: singleData.display_name,
              status: singleData.status,
              type: singleData.type,
              permissions: singleData.permissions,
            };
          }
        } catch {
          // ignore error
        }

        try {
          const messagesRes = await fetch(
            `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(targetInbox)}/messages`,
            {
              headers: {
                Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
              },
            },
          );
          messagesStatus = messagesRes.status;
          if (messagesRes.ok) {
            const msgData = (await messagesRes.json()) as { messages?: Array<Record<string, unknown>> };
            recentMessages = (msgData.messages ?? []).slice(0, 10).map((m) => ({
              message_id_present: Boolean(m.message_id || m.id),
              thread_id_present: Boolean(m.thread_id),
              to: m.to,
              subject_classification: typeof m.subject === "string" ? m.subject.replace(/[a-zA-Z0-9_-]{8,}/g, "[REDACTED]") : null,
              created_at: m.created_at || m.timestamp,
            }));
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      hasApiKey,
      configuredInboxId,
      authResetInboxId,
      listStatus,
      inboxes,
      listError,
      singleInboxStatus,
      singleInboxDetails,
      messagesStatus,
      recentMessages,
    };
  },
});
