import { beforeAll, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  normalizeEmail,
  tryNormalizeEmail,
  generateNumericVerificationCode,
  computeResetIdempotencyKey,
} from "../convex/authShared";
import { normalizeAuthError, maskEmail } from "../src/authErrors";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const modules = import.meta.glob("../convex/**/*.*s");

describe("password identity normalization", () => {
  beforeAll(async () => {
    const keys = await generateKeyPair("RS256", { extractable: true });
    const privateKey = await exportPKCS8(keys.privateKey);
    const publicKey = await exportJWK(keys.publicKey);
    process.env.JWT_PRIVATE_KEY = privateKey.trimEnd().replace(/\n/g, " ");
    process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
    process.env.CONVEX_SITE_URL = "http://localhost:3000";
    process.env.SITE_URL = "http://localhost:3000";
  });

  it("trims and lowercases without Gmail-specific rewriting", () => {
    expect(normalizeEmail("  Owner+tag@Example.COM ")).toBe(
      "owner+tag@example.com",
    );
    expect(normalizeEmail("Owner.Name@example.com")).toBe(
      "owner.name@example.com",
    );
    expect(tryNormalizeEmail("not-an-email")).toBeNull();
  });

  it("checks the Convex Auth users table using the normalized email", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: "owner@example.com" });
    });

    await expect(
      t.query(api.myFunctions.accountExistsForEmail, {
        email: "  OWNER@EXAMPLE.COM ",
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(api.myFunctions.accountExistsForEmail, {
        email: "other@example.com",
      }),
    ).resolves.toBe(false);
  });

  it("handles sign up, normalized sign in, case variants, and wrong password rejection", { timeout: 40000 }, async () => {
    const t = convexTest(schema, modules);

    // Sign up
    const signUpResult = await t.action(api.auth.signIn, {
      params: {
        flow: "signUp",
        email: "Fixture.Owner@Example.com ",
        password: "secretPassword123",
      },
      provider: "password",
    });

    expect(signUpResult).toBeDefined();

    // Query user and authAccounts
    const user = await t.run(async (ctx) => {
      const u = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", "fixture.owner@example.com"))
        .unique();
      const a = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", "fixture.owner@example.com"),
        )
        .unique();
      return { user: u, account: a };
    });

    expect(user.user).not.toBeNull();
    expect(user.user?.email).toBe("fixture.owner@example.com");
    expect(user.account).not.toBeNull();
    expect(user.account?.providerAccountId).toBe("fixture.owner@example.com");

    // Sign in with exact email
    const signInResult1 = await t.action(api.auth.signIn, {
      params: {
        flow: "signIn",
        email: "fixture.owner@example.com",
        password: "secretPassword123",
      },
      provider: "password",
    });
    expect(signInResult1).toBeDefined();

    // Sign in with uppercase variant
    const signInResult2 = await t.action(api.auth.signIn, {
      params: {
        flow: "signIn",
        email: "FIXTURE.OWNER@EXAMPLE.COM",
        password: "secretPassword123",
      },
      provider: "password",
    });
    expect(signInResult2).toBeDefined();

    // Sign in with whitespace variant
    const signInResult3 = await t.action(api.auth.signIn, {
      params: {
        flow: "signIn",
        email: "   fixture.owner@example.com   ",
        password: "secretPassword123",
      },
      provider: "password",
    });
    expect(signInResult3).toBeDefined();

    // Sign in with wrong password
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "signIn",
          email: "fixture.owner@example.com",
          password: "wrongPassword999",
        },
        provider: "password",
      }),
    ).rejects.toThrow();

    // Sign in with nonexistent email
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "signIn",
          email: "nonexistent@example.com",
          password: "somePassword123",
        },
        provider: "password",
      }),
    ).rejects.toThrow();

    // Verify tenant job ownership is preserved
    const createdJobId = await t.run(async (ctx) => {
      return await ctx.db.insert("jobs", {
        ownerId: user.user!._id,
        serviceCategory: "Electrical",
        jobTitle: "Electrical request",
        naturalLanguageDescription: "Fix bulbs",
        serviceLocation: "Lagos",
        desiredTiming: "today",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        missingFields: [],
        status: "needs_user",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const ownedJobs = await t.run(async (ctx) => {
      return await ctx.db
        .query("jobs")
        .withIndex("by_owner", (q) => q.eq("ownerId", user.user!._id))
        .collect();
    });

    expect(ownedJobs.length).toBe(1);
    expect(ownedJobs[0]._id).toBe(createdJobId);

    // ============================================
    // PASSWORD RECOVERY / FORGOT PASSWORD FLOW
    // ============================================

    // 1. Enumeration safety: requesting reset for nonexistent email resolves safely
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "reset",
          email: "nonexistent-user@example.com",
        },
        provider: "password",
      }),
    ).resolves.toBeDefined();

    // 2. Request reset with whitespace / uppercase email variant
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "reset",
          email: "  FIXTURE.OWNER@EXAMPLE.COM  ",
        },
        provider: "password",
      }),
    ).resolves.toBeDefined();

    // Verify verification code was issued
    const resetCapture = (globalThis as any).__lastResetCode as
      | { email: string; token: string }
      | undefined;
    expect(resetCapture).toBeDefined();
    expect(resetCapture?.token).toBeDefined();
    const validCode = resetCapture!.token;

    // 3. Short password rejected (< 8 chars)
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "reset-verification",
          email: "fixture.owner@example.com",
          code: validCode,
          newPassword: "short",
        },
        provider: "password",
      }),
    ).rejects.toThrow();

    // 4. Invalid verification code rejected
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "reset-verification",
          email: "fixture.owner@example.com",
          code: "wrong-code-999",
          newPassword: "brandNewPassword789",
        },
        provider: "password",
      }),
    ).rejects.toThrow();

    // 5. Valid verification code changes password and authenticates
    const resetResult = await t.action(api.auth.signIn, {
      params: {
        flow: "reset-verification",
        email: "fixture.owner@example.com",
        code: validCode,
        newPassword: "brandNewPassword789",
      },
      provider: "password",
    });
    expect(resetResult).toBeDefined();

    // 6. Identity preservation & duplicate avoidance
    const postResetState = await t.run(async (ctx) => {
      const allUsers = await ctx.db.query("users").collect();
      const allAccounts = await ctx.db.query("authAccounts").collect();
      const userDoc = await ctx.db.get("users", user.user!._id);
      const accountDoc = await ctx.db.get("authAccounts", user.account!._id);
      const messages = await ctx.db.query("outreachMessages").collect();
      const job = await ctx.db.get("jobs", createdJobId);
      return {
        allUsers,
        allAccounts,
        userDoc,
        accountDoc,
        messages,
        job,
      };
    });

    // Exactly 1 user and 1 authAccount exist (no second user created)
    expect(postResetState.allUsers.length).toBe(1);
    expect(postResetState.allAccounts.length).toBe(1);
    expect(postResetState.userDoc?._id).toBe(user.user!._id);
    expect(postResetState.accountDoc?._id).toBe(user.account!._id);
    expect(postResetState.accountDoc?.userId).toBe(user.user!._id);

    // Procurement isolation: no outreach messages created by password reset
    expect(postResetState.messages.length).toBe(0);

    // Job ownership preserved
    expect(postResetState.job?.ownerId).toBe(user.user!._id);

    // 7. Old password no longer works
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "signIn",
          email: "fixture.owner@example.com",
          password: "secretPassword123",
        },
        provider: "password",
      }),
    ).rejects.toThrow();

    // 8. New password works with case/whitespace variations
    const newSignIn = await t.action(api.auth.signIn, {
      params: {
        flow: "signIn",
        email: "  Fixture.Owner@example.com ",
        password: "brandNewPassword789",
      },
      provider: "password",
    });
    expect(newSignIn).toBeDefined();
  });

  it("generates an exact 8-digit numeric code with uniform random distribution", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateNumericVerificationCode(8);
      expect(code).toHaveLength(8);
      expect(/^\d{8}$/.test(code)).toBe(true);
    }
  });

  it("computes deterministic, collision-resistant idempotency keys without exposing raw tokens", async () => {
    const key1 = await computeResetIdempotencyKey("user@example.com", "12345678");
    const key2 = await computeResetIdempotencyKey("user@example.com", "12345678");
    const keyDiffEmail = await computeResetIdempotencyKey("other@example.com", "12345678");
    const keyDiffToken = await computeResetIdempotencyKey("user@example.com", "87654321");

    expect(key1).toBe(key2);
    expect(key1.startsWith("pwd-reset-")).toBe(true);
    expect(key1).not.toContain("12345678");
    expect(key1).not.toBe(keyDiffEmail);
    expect(key1).not.toBe(keyDiffToken);
  });

  it("handles duplicate sign up with clean error from server", async () => {
    const t = convexTest(schema, modules);
    // Initial signup
    await t.action(api.auth.signIn, {
      params: {
        flow: "signUp",
        email: "firstuser@example.com",
        password: "firstPassword123",
      },
      provider: "password",
    });

    // Attempt duplicate signup with different password
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "signUp",
          email: "firstuser@example.com",
          password: "secondPassword456",
        },
        provider: "password",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects sign up with password shorter than 8 characters", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.auth.signIn, {
        params: {
          flow: "signUp",
          email: "newuser@example.com",
          password: "short",
        },
        provider: "password",
      }),
    ).rejects.toThrow(/at least 8 characters/i);
  });
});

describe("central auth error normalization and leakage prevention", () => {
  const forbiddenSubstrings = [
    "CONVEX",
    "auth:signIn",
    "Request ID",
    "Called by client",
    "Server Error",
    "\n  at ",
    "at (",
    ".ts:",
    ".js:",
    "node_modules",
  ];

  function assertNoLeakage(message: string) {
    for (const forbidden of forbiddenSubstrings) {
      expect(message).not.toContain(forbidden);
    }
  }

  it("correctly masks emails for privacy in success confirmations", () => {
    expect(maskEmail("fixture.owner@example.com")).toBe("f***r@example.com");
    expect(maskEmail("john.doe@example.com")).toBe("j***e@example.com");
    expect(maskEmail("ab@domain.com")).toBe("a*@domain.com");
    expect(maskEmail("invalid")).toBe("invalid");
  });

  it("normalizes malformed/invalid email errors without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught Error: Enter a valid email address.\n  at convex/auth.ts:18:5\nCalled by client",
    );
    const result = normalizeAuthError(rawConvex, "signUp");
    expect(result.code).toBe("INVALID_EMAIL");
    expect(result.field).toBe("email");
    expect(result.message).toBe("Enter a valid email address.");
    assertNoLeakage(result.message);
  });

  it("normalizes password too short error without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught ConvexError: Password must be at least 8 characters.\n  at convex/auth.ts:200:11\nCalled by client",
    );
    const resultSignUp = normalizeAuthError(rawConvex, "signUp");
    expect(resultSignUp.code).toBe("PASSWORD_TOO_SHORT");
    expect(resultSignUp.field).toBe("password");
    expect(resultSignUp.message).toBe("Use a password with at least 8 characters.");
    assertNoLeakage(resultSignUp.message);

    const resultReset = normalizeAuthError(rawConvex, "reset-verification");
    expect(resultReset.code).toBe("PASSWORD_TOO_SHORT");
    expect(resultReset.field).toBe("newPassword");
    assertNoLeakage(resultReset.message);
  });

  it("normalizes duplicate account error without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught ConvexError: An account with this email already exists. Sign in instead.\n  at convex/auth.ts:198:11\nCalled by client",
    );
    const result = normalizeAuthError(rawConvex, "signUp");
    expect(result.code).toBe("ACCOUNT_EXISTS");
    expect(result.field).toBe("email");
    expect(result.message).toBe("An account with this email already exists. Sign in instead.");
    assertNoLeakage(result.message);
  });

  it("normalizes wrong password / invalid credentials without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught ConvexError: Invalid credentials\n  at convex/auth.ts:194:11\nCalled by client",
    );
    const result = normalizeAuthError(rawConvex, "signIn");
    expect(result.code).toBe("INVALID_CREDENTIALS");
    expect(result.field).toBe("general");
    expect(result.message).toBe("Email or password is incorrect.");
    assertNoLeakage(result.message);
  });

  it("normalizes invalid verification code without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught ConvexError: Invalid verification code\n  at convex/auth.ts:200:11\nCalled by client",
    );
    const result = normalizeAuthError(rawConvex, "reset-verification");
    expect(result.code).toBe("RESET_CODE_INVALID");
    expect(result.field).toBe("code");
    expect(result.message).toBe("That verification code is incorrect. Check the code and try again.");
    assertNoLeakage(result.message);
  });

  it("normalizes expired verification code without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught Error: Verification code expired\n  at convex/auth.ts:18:5\nCalled by client",
    );
    const result = normalizeAuthError(rawConvex, "reset-verification");
    expect(result.code).toBe("RESET_CODE_EXPIRED");
    expect(result.field).toBe("code");
    expect(result.message).toBe("That verification code has expired. Request a new one.");
    assertNoLeakage(result.message);
  });

  it("normalizes rate limit without leaking internals", () => {
    const rawConvex = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught ConvexError: Too many sign-in attempts. Try again later.\n  at convex/auth.ts:205:11\nCalled by client",
    );
    const result = normalizeAuthError(rawConvex, "signIn");
    expect(result.code).toBe("RATE_LIMIT");
    expect(result.field).toBe("general");
    expect(result.message).toBe("Too many attempts. Please try again shortly.");
    assertNoLeakage(result.message);
  });

  it("normalizes network and fetch errors cleanly", () => {
    const networkError = new TypeError("Failed to fetch");
    const result = normalizeAuthError(networkError, "signIn");
    expect(result.code).toBe("NETWORK_ERROR");
    expect(result.field).toBe("general");
    expect(result.message).toBe("We couldn't reach Findor. Check your connection and try again.");
    assertNoLeakage(result.message);
  });

  it("normalizes completely unknown Convex errors, extracts neutral ref ID, and never leaks raw blob", () => {
    const rawConvexBlob = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: 03ad7a87e50529ef] Server Error\nUncaught Error: Some unexpected internal database failure\n  at convex/internal.ts:42:1\nCalled by client",
    );
    const result = normalizeAuthError(rawConvexBlob, "signIn");
    expect(result.code).toBe("UNKNOWN");
    expect(result.field).toBe("general");
    expect(result.message).toBe("We couldn't complete that request right now. Please try again.");
    expect(result.referenceId).toBe("03AD7A87");
    assertNoLeakage(result.message);
  });

  it("extracts error info from ConvexError data property even when message contains only server wrapper", () => {
    const convexErrorWithData = {
      message: "[CONVEX A(auth:signIn)] [Request ID: 2ae4ed92661d9a20] Server Error\nCalled by client",
      data: "An account with this email already exists. Sign in instead.",
    };
    const result = normalizeAuthError(convexErrorWithData, "signUp");
    expect(result.code).toBe("ACCOUNT_EXISTS");
    expect(result.field).toBe("email");
    expect(result.message).toBe("An account with this email already exists. Sign in instead.");
    expect(result.referenceId).toBe("2AE4ED92");
    assertNoLeakage(result.message);
  });

  it("handles multi-line stack traces with 'at ' frames before the error message without truncating", () => {
    const complexTrace = new Error(
      `[CONVEX A(auth:signIn)] [Request ID: 2ae4ed92661d9a20] Server Error
  at createAccountFromCredentialsImpl (file:///convex/auth.ts:55:13)
  at async storeImpl (file:///convex/auth.ts:52:14)
Uncaught ConvexError: An account with this email already exists. Sign in instead.
Called by client`,
    );
    const result = normalizeAuthError(complexTrace, "signUp");
    expect(result.code).toBe("ACCOUNT_EXISTS");
    expect(result.field).toBe("email");
    expect(result.message).toBe("An account with this email already exists. Sign in instead.");
    expect(result.referenceId).toBe("2AE4ED92");
    assertNoLeakage(result.message);
  });

  it("proves complete fresh user lifecycle: signup -> auth -> signout -> signin -> duplicate rejection -> invalid password rejection", { timeout: 45000 }, async () => {
    const t = convexTest(schema, modules);
    const freshEmail = "brand.new.user.20260917@example.com";
    const password = "ValidPassword123!";

    // 1. Fresh email sign up
    const signUpResult = await t.action(api.auth.signIn, {
      params: {
        flow: "signUp",
        email: freshEmail,
        password: password,
      },
      provider: "password",
    });

    expect(signUpResult).toBeDefined();
    expect((signUpResult as any)?.tokens).toBeDefined();

    // 2. Exactly one user and one authAccount exist
    const userState = await t.run(async (ctx) => {
      const users = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", freshEmail))
        .collect();
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", freshEmail),
        )
        .collect();
      return { users, accounts };
    });

    expect(userState.users.length).toBe(1);
    expect(userState.accounts.length).toBe(1);
    expect(userState.accounts[0].userId).toBe(userState.users[0]._id);

    // 3. Sign in with same credentials succeeds
    const signInResult = await t.action(api.auth.signIn, {
      params: {
        flow: "signIn",
        email: freshEmail,
        password: password,
      },
      provider: "password",
    });
    expect(signInResult).toBeDefined();
    expect((signInResult as any)?.tokens).toBeDefined();

    // 4. Duplicate sign up with same email is rejected with clean ACCOUNT_EXISTS ConvexError
    let duplicateError: unknown = null;
    try {
      await t.action(api.auth.signIn, {
        params: {
          flow: "signUp",
          email: freshEmail,
          password: "AnotherPassword456!",
        },
        provider: "password",
      });
    } catch (err) {
      duplicateError = err;
    }

    expect(duplicateError).not.toBeNull();
    const normalizedDuplicate = normalizeAuthError(duplicateError, "signUp");
    expect(normalizedDuplicate.code).toBe("ACCOUNT_EXISTS");
    expect(normalizedDuplicate.message).toBe("An account with this email already exists. Sign in instead.");
    expect(normalizedDuplicate.field).toBe("email");
    assertNoLeakage(normalizedDuplicate.message);

    // Verify still exactly 1 user and 1 authAccount in DB
    const postDuplicateState = await t.run(async (ctx) => {
      const users = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", freshEmail))
        .collect();
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", freshEmail),
        )
        .collect();
      return { users, accounts };
    });
    expect(postDuplicateState.users.length).toBe(1);
    expect(postDuplicateState.accounts.length).toBe(1);

    // 5. Sign in with wrong password is rejected with clean INVALID_CREDENTIALS
    let wrongPasswordError: unknown = null;
    try {
      await t.action(api.auth.signIn, {
        params: {
          flow: "signIn",
          email: freshEmail,
          password: "WrongPassword999!",
        },
        provider: "password",
      });
    } catch (err) {
      wrongPasswordError = err;
    }

    expect(wrongPasswordError).not.toBeNull();
    const normalizedWrongPw = normalizeAuthError(wrongPasswordError, "signIn");
    expect(normalizedWrongPw.code).toBe("INVALID_CREDENTIALS");
    expect(normalizedWrongPw.message).toBe("Email or password is incorrect.");
    expect(normalizedWrongPw.field).toBe("general");
    assertNoLeakage(normalizedWrongPw.message);
  });
});
