"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";
import {
  buildUnderstandingPrompt,
  responseUnderstandingJsonSchema,
} from "./inboundParsing";
import {
  OPENAI_PROVIDER_REPLY_MODEL,
  parseOpenAIProviderReplyOutput,
  providerReplySystemPrompt,
} from "./providerReplyInterpreter";

const REQUEST_TIMEOUT_MS = 20_000;

const providerReplyInputValidator = v.object({
  serviceCategory: v.string(),
  serviceLocation: v.string(),
  requestedOutcome: v.string(),
  desiredTiming: v.string(),
  serviceContext: v.string(),
  providerName: v.string(),
  sender: v.string(),
  subject: v.string(),
  bodyText: v.string(),
  attachments: v.array(
    v.object({
      filename: v.optional(v.string()),
      contentType: v.optional(v.string()),
      size: v.optional(v.number()),
    }),
  ),
});

const responseKindValidator = v.union(
  v.literal("quote"),
  v.literal("needs_information"),
  v.literal("availability"),
  v.literal("decline"),
  v.literal("acknowledgement"),
  v.literal("other"),
  v.literal("mixed"),
  v.literal("unclear"),
);

const structuredUnderstandingValidator = v.object({
  kind: responseKindValidator,
  headlinePrice: v.union(v.string(), v.null()),
  priceQualifier: v.union(
    v.literal("exact"),
    v.literal("estimate"),
    v.literal("starting_from"),
    v.literal("range"),
    v.literal("unknown"),
    v.null(),
  ),
  priceMin: v.union(v.number(), v.null()),
  priceMax: v.union(v.number(), v.null()),
  currency: v.union(v.string(), v.null()),
  availability: v.union(v.string(), v.null()),
  estimatedTiming: v.union(v.string(), v.null()),
  included: v.array(v.string()),
  excluded: v.array(v.string()),
  notStated: v.array(v.string()),
  unclear: v.array(v.string()),
  paymentTerms: v.union(v.string(), v.null()),
  warranty: v.union(v.string(), v.null()),
  assumptions: v.array(v.string()),
  informationNeeded: v.array(v.string()),
  inspectionRequirement: v.union(v.string(), v.null()),
  importantNotes: v.array(v.string()),
  evidenceText: v.string(),
  summary: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  requestedSensitiveInformation: v.array(v.string()),
  requestedCommitments: v.array(v.string()),
  evidence: v.array(
    v.object({
      field: v.string(),
      excerpt: v.string(),
    }),
  ),
});

const interpretationResultValidator = v.object({
  status: v.union(v.literal("ok"), v.literal("unavailable"), v.literal("failed")),
  model: v.union(v.string(), v.null()),
  response: v.union(structuredUnderstandingValidator, v.null()),
});

export const interpret = internalAction({
  args: { input: providerReplyInputValidator },
  returns: interpretationResultValidator,
  handler: async (_ctx, args) => {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return { status: "unavailable" as const, model: null, response: null };
    }

    try {
      const client = new OpenAI({
        apiKey,
        maxRetries: 0,
        timeout: REQUEST_TIMEOUT_MS,
      });
      const response = await client.responses.create({
        model: OPENAI_PROVIDER_REPLY_MODEL,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 2_000,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: providerReplySystemPrompt }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildUnderstandingPrompt(args.input),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "findor_provider_response",
            strict: true,
            schema: responseUnderstandingJsonSchema,
          },
        },
      });
      const outputText = response.output_text?.trim();
      if (!outputText) throw new Error("OpenAI returned no structured output.");
      return {
        status: "ok" as const,
        model: "openai/" + OPENAI_PROVIDER_REPLY_MODEL,
        response: parseOpenAIProviderReplyOutput(outputText),
      };
    } catch {
      // Do not expose provider content, prompts, credentials, or raw API errors.
      // The caller records the existing safe needs_review state.
      return { status: "failed" as const, model: null, response: null };
    }
  },
});
