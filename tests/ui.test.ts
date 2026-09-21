/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { ErrorBoundary } from "../src/ErrorBoundary";
import { getProcessRailSteps } from "../src/processRail";
import {
  buildOutreachLedgerRows,
  countContactedProviders,
  countContactedProvidersInCycle,
  providerEventMessage,
  sendStateLabel,
  providerStateLabel,
  followUpStateLabel,
} from "../src/outreachLedger";
import { resolveBusinessDisplay } from "../src/providerDisplay";
import { mandateSnapshot } from "../convex/jobs";
import {
  BriefReview,
  OutreachLedger,
  Timeline,
  CycleHistoryBar,
  ResponseSummary,
  ZeroResultCard,
  CurrentStateHero,
  MultiJobDashboard,
} from "../src/App";
import { ProjectHub } from "../src/components/ProjectHub";
import { ProjectsHome } from "../src/components/ProjectsHome";
import { ConversationalIntake } from "../src/components/ConversationalIntake";
import { resolveConsumerProjectState } from "../src/projectState";
import { isSafeConsumerString } from "../src/projectErrors";
import {
  responseKindLabel,
  processingStatusCopy,
  formatList,
  priceRange,
  formatBytes,
  formatEventTime,
  formatEnumLabel,
  formatTimingLabel,
} from "../src/formatters";

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated component explosion");
  }
  return React.createElement("div", null, "Healthy component");
}

describe("UI rendering, legacy resilience, and error boundaries", () => {
  it("renders ErrorBoundary fallback when in error state", () => {
    const derived = ErrorBoundary.getDerivedStateFromError(new Error("Simulated component explosion"));
    expect(derived.hasError).toBe(true);
    expect(derived.error?.message).toBe("Simulated component explosion");

    const boundary = new ErrorBoundary({
      fallbackTitle: "Findor couldn’t load this workspace.",
      children: React.createElement(ProblemChild, { shouldThrow: false }),
    });
    boundary.state = derived;

    const rendered = boundary.render();
    const html = renderToString(rendered as React.ReactElement);

    expect(html).toContain("Findor couldn’t load this workspace.");
    expect(html).toContain("Workspace Notice");
    expect(html).toContain("Retry");
    expect(html).toContain("Reload page");
  });

  it("renders ErrorBoundary children normally when no exception is thrown", () => {
    const html = renderToString(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(ProblemChild, { shouldThrow: false }),
      ),
    );

    expect(html).toContain("Healthy component");
  });

  it("safely generates synthesized legacy cycle and mandate snapshot without throwing", () => {
    const legacyAutonomy = {
      enabled: true,
      maxProviders: 3,
      allowInitialOutreach: true,
      allowRoutineClarifications: true,
      allowFollowUp: true,
      maxFollowUps: 1,
      preference: "balanced" as const,
    };

    const snapshot = mandateSnapshot(legacyAutonomy, false);
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.maxProviders).toBe(3);
    expect(snapshot.includePreviouslyContacted).toBe(false);
  });

  it("safely renders process rail steps for legacy jobs with missing autonomy/briefApprovedAt", () => {
    const legacyJob = {
      status: "outreach_sent" as const,
      // briefApprovedAt and autonomy are undefined on raw legacy documents
    };

    const steps = getProcessRailSteps(legacyJob);
    expect(steps.length).toBe(5);
    expect(steps[0].complete).toBe(true);
    expect(steps[1].complete).toBe(true);
  });

  it("does not show old mandate approval on process rail when brief is under review or paused in review", () => {
    // Job that had a previous cycle approved (briefApprovedAt was set), but is now on Brief v2 (brief_ready)
    const reviewJob = {
      status: "brief_ready" as const,
      briefApprovedAt: 1700000000000,
      autonomy: { approvedAt: 1700000000000, enabled: true },
    };

    const steps = getProcessRailSteps(reviewJob);
    expect(steps[0].complete).toBe(true); // Describe the service
    expect(steps[1].complete).toBe(false); // Review the brief (pending)
    expect(steps[2].complete).toBe(false); // Approve Findor's mandate (must not carry over old approval!)
    expect(steps[3].complete).toBe(false); // Findor researches and contacts eligible providers
    expect(steps[4].complete).toBe(false); // Review replies and options

    // Same when paused with pausedFromStatus = brief_ready
    const pausedReviewJob = {
      status: "paused" as const,
      pausedFromStatus: "brief_ready" as const,
      briefApprovedAt: 1700000000000,
      autonomy: { approvedAt: 1700000000000, enabled: true },
    };

    const pausedSteps = getProcessRailSteps(pausedReviewJob);
    expect(pausedSteps[0].complete).toBe(true);
    expect(pausedSteps[1].complete).toBe(false);
    expect(pausedSteps[2].complete).toBe(false);
  });

  it("safely builds outreach ledger and event messages for legacy records without crashing", () => {
    const legacyMessages = [
      {
        _id: "msg_1",
        candidateId: "cand_1",
        providerEmail: "info@reiscleaners.example.test",
        status: "sent",
        createdAt: 1789481124827,
        updatedAt: 1789481124827,
      },
    ];

    const legacyCandidates = [
      {
        _id: "cand_1",
        name: "Reis Cleaners",
      },
    ];

    const rows = buildOutreachLedgerRows(legacyMessages, legacyCandidates);
    expect(rows.length).toBe(1);
    expect(rows[0].providerName).toBe("Reis Cleaners");
    expect(rows[0].sendState).toBe("Sent");
    expect(rows[0].providerState).toBe("Waiting for reply");

    const event = {
      _id: "evt_1",
      eventType: "outreach_sent",
      message: "Outreach sent to provider.",
      createdAt: 1789481124827,
    };

    const formattedMessage = providerEventMessage(event, legacyMessages, legacyCandidates);
    expect(formattedMessage).toBe("AgentMail accepted outreach to Reis Cleaners.");
  });

  it("safely formats all outreach states without null exceptions", () => {
    expect(sendStateLabel("sent")).toBe("Sent");
    expect(sendStateLabel("delivery_failed")).toBe("Delivery failed");
    expect(providerStateLabel(undefined)).toBe("Not started");
    expect(providerStateLabel("no_response")).toBe("No response");
    expect(followUpStateLabel(undefined)).toBe("Not planned");
    expect(followUpStateLabel("scheduled")).toBe("Planned");
  });

  it("renders BriefReview cleanly with legacy brief shape (including object-style or missing structuredRequirements)", () => {
    const legacyJob = {
      _id: "job_legacy_1" as any,
      _creationTime: 1789481100000,
      ownerId: "user_1" as any,
      serviceCategory: "Residential cleaning",
      jobTitle: "Residential cleaning in Lagos",
      naturalLanguageDescription: "Deep cleaning for residential home in Victoria Island.",
      serviceLocation: "Lagos, Nigeria",
      desiredTiming: "Flexible next week",
      budgetOrContext: "Standard residential cleaning",
      structuredRequirements: {
        rawDetails: "Deep cleaning in Lagos",
        keyDetails: [{ label: "Scope", value: "Deep clean" }],
      },
      status: "outreach_sent" as const,
      missingFields: [],
      brief: {
        projectSummary: "Residential cleaning in Victoria Island, Lagos",
        serviceCategory: "Residential cleaning",
        requestedOutcome: "Full deep clean of the premises",
        serviceLocation: "Lagos, Nigeria",
        desiredTiming: "Flexible next week",
        budgetOrContext: "Standard residential cleaning",
        // Legacy brief may have object-style or array structuredRequirements
        structuredRequirements: [{ label: "Scope", value: "Deep clean" }],
        unknowns: ["Specific room count"],
      },
      createdAt: 1789481100000,
      updatedAt: 1789481150000,
    };

    const html = renderToString(
      React.createElement(BriefReview as any, {
        job: legacyJob,
        onApprove: () => {},
        isApproving: false,
        error: null,
      }),
    );

    expect(html).toContain("Review your standardized brief");
    expect(html).toContain("Residential cleaning in Victoria Island, Lagos");
    expect(html).toContain("Deep clean");
    expect(html).toContain("Specific room count");
  });

  it("renders OutreachLedger cleanly with real Reis and CLEANLY legacy outreach records", () => {
    const legacyMessages = [
      {
        _id: "kd7b2f2d5mn60nymt11nacnatn8een8m",
        candidateId: "cand_reis",
        providerEmail: "info@reiscleaners.example.test",
        status: "sent",
        purpose: "initial",
        providerResolution: "replied",
        followUpState: "skipped",
        externalMessageId: "msg_reis_1",
        externalThreadId: "thread_reis_1",
        createdAt: 1789481124827,
        updatedAt: 1789481124827,
      },
      {
        _id: "msg_cleanly_1",
        candidateId: "cand_cleanly",
        providerEmail: "contact@cleanly.example.test",
        status: "sent",
        purpose: "initial",
        providerResolution: "no_response",
        followUpState: "sent",
        externalMessageId: "msg_cleanly_1",
        externalThreadId: "thread_cleanly_1",
        createdAt: 1789481124830,
        updatedAt: 1789481124830,
      },
      {
        _id: "msg_cleanly_fu",
        candidateId: "cand_cleanly",
        parentOutreachId: "msg_cleanly_1",
        purpose: "follow_up",
        status: "sent",
        providerEmail: "contact@cleanly.example.test",
        externalMessageId: "msg_cleanly_fu_ext",
        externalThreadId: "thread_cleanly_1",
        createdAt: 1789481200000,
        updatedAt: 1789481200000,
      },
    ];

    const legacyCandidates = [
      { _id: "cand_reis", name: "Reis Cleaners" },
      { _id: "cand_cleanly", name: "Cleanly Nigeria" },
    ];

    const rows = buildOutreachLedgerRows(legacyMessages, legacyCandidates);
    expect(rows.length).toBe(2); // Only initial outreach appear as primary ledger rows

    const html = renderToString(
      React.createElement(OutreachLedger, { rows }),
    );

    expect(html).toContain("Outreach ledger");
    expect(html).toContain("Reis Cleaners");
    expect(html).toContain("Cleanly Nigeria");
    expect(html).toContain("info@reiscleaners.example.test");
    expect(html).toContain("contact@cleanly.example.test");
    expect(html).toContain("Provider replied");
    expect(html).toContain("No response");
    expect(html).toContain("Real AgentMail receipt stored.");
  });

  it("renders Timeline and event history cleanly for real legacy event trail", () => {
    const legacyEvents = [
      {
        _id: "evt_created" as any,
        _creationTime: 1789481100000,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        eventType: "job_created" as const,
        message: "Request created.",
        createdAt: 1789481100000,
      },
      {
        _id: "evt_brief_approved" as any,
        _creationTime: 1789481120000,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        eventType: "brief_approved" as const,
        message: "Job Brief and mandate approved.",
        createdAt: 1789481120000,
      },
      {
        _id: "evt_outreach_reis" as any,
        _creationTime: 1789481124827,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        eventType: "outreach_sent" as const,
        message: "Outreach sent to provider.",
        createdAt: 1789481124827,
      },
      {
        _id: "evt_fu_cleanly" as any,
        _creationTime: 1789481200000,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        eventType: "follow_up_sent" as const,
        message: "Follow-up sent to Cleanly Nigeria.",
        createdAt: 1789481200000,
      },
      {
        _id: "evt_inbound_reis" as any,
        _creationTime: 1789481250000,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        eventType: "inbound_received" as const,
        message: "Provider message received from info@reiscleaners.example.test.",
        createdAt: 1789481250000,
      },
    ];

    const legacyOutreach = [
      {
        _id: "kd7b2f2d5mn60nymt11nacnatn8een8m" as any,
        _creationTime: 1789481124827,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        candidateId: "cand_reis" as any,
        status: "sent" as const,
        purpose: "initial" as const,
        providerEmail: "info@reiscleaners.example.test",
        subject: "Cleaning service inquiry",
        body: "Hi Reis Cleaners...",
        createdAt: 1789481124827,
        updatedAt: 1789481124827,
      },
    ];

    const legacyCandidates = [
      {
        _id: "cand_reis" as any,
        _creationTime: 1789481110000,
        jobId: "job_1" as any,
        ownerId: "user_1" as any,
        name: "Reis Cleaners",
        url: "https://reiscleaners.com.ng",
        description: "Professional cleaning in Lagos",
        contactability: "email_found" as const,
        contactEmail: "info@reiscleaners.example.test",
        evidence: [],
        discoveredAt: 1789481110000,
      },
    ];

    const html = renderToString(
      React.createElement(Timeline, {
        events: legacyEvents,
        outreachItems: legacyOutreach,
        candidates: legacyCandidates,
      }),
    );

    expect(html).toContain("Request record");
    expect(html).toContain("What has happened");
    expect(html).toContain("AgentMail accepted outreach to Reis Cleaners.");
    expect(html).toContain("Provider message received from info@reiscleaners.example.test.");
  });

  it("renders CycleHistoryBar cleanly with synthesized legacy Cycle 1", () => {
    const cycleHistory = [
      {
        cycle: {
          _id: "synthesized_cycle_1",
          cycleNumber: 1,
          briefVersion: 1,
          mandateSnapshot: {
            enabled: true,
            maxProviders: 3,
            allowInitialOutreach: true,
            allowRoutineClarifications: true,
            allowFollowUp: true,
            maxFollowUps: 1,
            preference: "balanced" as const,
            includePreviouslyContacted: false,
          },
          maxProviders: 3,
          status: "active",
          recoveryEnabled: true,
          recoveryDiscoveryCycles: 0,
        },
        briefVersion: {
          version: 1,
        },
        candidateCount: 2,
        outreachCount: 2,
        responseCount: 0,
        responses: [],
      },
    ];

    const html = renderToString(
      React.createElement(CycleHistoryBar, {
        history: cycleHistory,
        selectedCycleNumber: null,
        onSelectCycle: () => {},
      }),
    );

    expect(html).toContain("Procurement Cycles");
    expect(html).toContain("Cycle");
    expect(html).toContain("active");
    expect(html.replace(/<!-- -->/g, "")).toContain("Procurement Cycles (1)");
    expect(html.replace(/<!-- -->/g, "")).toContain("Cycle 1");
    expect(html.replace(/<!-- -->/g, "")).toContain("(v1)");
  });

  it("renders ResponseSummary and helper formatters defensively with missing properties", () => {
    const partialResponse = {
      _id: "resp_1" as any,
      _creationTime: 1789481260000,
      ownerId: "user_1" as any,
      jobId: "job_1" as any,
      providerId: "cand_reis" as any,
      outreachId: "msg_1" as any,
      inboundMessageId: "inb_1" as any,
      kind: "acknowledgement" as const,
      evidenceText: "Thanks for choosing Reis cleaners, hopefully , we get back to you soon.",
      model: "openai-gpt-5.6-luna",
      createdAt: 1789481260000,
      updatedAt: 1789481260000,
      // all other fields undefined
    };

    const html = renderToString(
      React.createElement(ResponseSummary, { response: partialResponse as any }),
    );

    expect(html).toContain("Findor interpretation");
    expect(html).toContain("acknowledgement");
    expect(html).toContain("Interpretation evidence");

    expect(responseKindLabel(undefined)).toBe("Response");
    expect(responseKindLabel("needs_information")).toBe("needs information");
    expect(formatEnumLabel("needs_user")).toBe("Needs User");
    expect(formatTimingLabel("this_week")).toBe("This week");
    expect(formatTimingLabel("next_week")).toBe("Next week");
    expect(formatTimingLabel("asap")).toBe("Today / urgently");
    expect(processingStatusCopy(undefined)).toBe("Reply received");
    expect(processingStatusCopy("needs_review")).toBe("Needs review");
    expect(formatList(undefined)).toBe("Not stated");
    expect(formatList([])).toBe("Not stated");
    expect(formatList(["A", "B"])).toBe("A, B");
    expect(priceRange(undefined)).toBe("Not stated");
    expect(priceRange({ priceMin: 50000, currency: "NGN" })).toBe("NGN 50000");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatEventTime(undefined)).toBe("");
    expect(formatEventTime(1789481100000)).not.toBe("");
  });

  it("renders BriefReview in paused state with disabled start button and resume guidance", () => {
    const pausedJob = {
      _id: "job_paused_1" as any,
      _creationTime: 1789481100000,
      ownerId: "user_1" as any,
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring and install GFCI",
      naturalLanguageDescription: "Exposed electrical wiring in garage needs inspection and GFCI outlets.",
      serviceLocation: "Austin, Texas",
      desiredTiming: "Next week",
      budgetOrContext: "$400",
      status: "paused" as const,
      executionStatus: "paused" as const,
      pausedFromStatus: "brief_ready" as const,
      currentBriefVersion: 2,
      missingFields: [],
      brief: {
        projectSummary: "Electrical wiring repair and GFCI install in Austin, Texas",
        serviceCategory: "Electrical",
        requestedOutcome: "Safe inspected electrical wiring and GFCI outlets installed",
        serviceLocation: "Austin, Texas",
        desiredTiming: "Next week",
        budgetOrContext: "$400",
        structuredRequirements: [{ label: "Scope", value: "GFCI and wiring inspection" }],
        unknowns: [],
      },
      createdAt: 1789481100000,
      updatedAt: 1789481150000,
    };

    const html = renderToString(
      React.createElement(BriefReview as any, {
        job: pausedJob,
        onApprove: () => {},
        isApproving: false,
        error: null,
      }),
    );

    expect(html.replace(/<!-- -->/g, "")).toContain("Brief v2");
    expect(html).toContain("Paused");
    expect(html).toContain("Request is paused. Resume this request before approving Findor&#x27;s mandate and starting a cycle.");
    expect(html).toContain("Resume request to start");
    expect(html).not.toContain("Start finding options");
  });

  it("renders ZeroResultCard for zero-contactable research attempt truthfully", () => {
    const html = renderToString(
      React.createElement(ZeroResultCard, {
        briefVersion: 3,
        outreachCount: 0,
        onTryAgain: () => {},
        onEditRequest: () => {},
        onNewJob: () => {},
      }),
    );

    expect(html).toContain("Zero-Result Research");
    expect(html).toContain("No contactable providers found for this attempt");
    expect(html).toContain("no verified public business email route was found");
    expect(html).toContain("No provider was contacted, and Findor did not guess an email address.");
    expect(html).toContain("Try again");
    expect(html).toContain("Edit request");
    expect(html).toContain("New job");
  });

  it("renders ZeroResultCard for zero-response recovery attempt truthfully", () => {
    const html = renderToString(
      React.createElement(ZeroResultCard, {
        briefVersion: 1,
        outreachCount: 3,
        onTryAgain: () => {},
        onEditRequest: () => {},
        onNewJob: () => {},
      }),
    );

    expect(html).toContain("Zero-Result Recovery");
    expect(html).toContain("No usable options found for this cycle");
    expect(html).toContain("Findor reached out to suitable providers for this brief but did not obtain a usable estimate.");
    expect(html).toContain("Try again");
    expect(html).toContain("Edit request");
    expect(html).toContain("New job");
  });

  it("safely processes production Electrical request state with cycleId on candidate documents", () => {
    const productionCandidates = [
      {
        _id: "kn7ezqw360kyg9dx6wa6wys67d8ejay7" as any,
        _creationTime: 1789481100000,
        jobId: "kd76jzn457xdcj2rjnqzyhsnr98eb0wj" as any,
        ownerId: "kx7bhfswvbftcvze4zhzpcfzzd8ebgb7" as any,
        cycleId: "m57d34js0n889mvv560sntjnb98ekt12" as any,
        name: "Penz Auto & Electrical Repair",
        url: "https://example.com/penz",
        description: "Auto and electrical repair services",
        entityType: "provider" as const,
        contactability: "website_only" as const,
        evidence: [{ sourceUrl: "https://example.com/penz", claim: "Electrical repair services" }],
        discoveredAt: 1789481100000,
      },
      {
        _id: "kn7a1b2c3d4e5f6g7h8i9j0k" as any,
        _creationTime: 1789481100000,
        jobId: "kd76jzn457xdcj2rjnqzyhsnr98eb0wj" as any,
        ownerId: "kx7bhfswvbftcvze4zhzpcfzzd8ebgb7" as any,
        cycleId: "m57d34js0n889mvv560sntjnb98ekt12" as any,
        name: "Yelp Directory Austin Electrical",
        url: "https://yelp.com/c/austin/electricians",
        description: "Directory of local electricians",
        entityType: "discovery_source" as const,
        contactability: "website_only" as const,
        evidence: [{ sourceUrl: "https://yelp.com", claim: "Directory listing" }],
        discoveredAt: 1789481100000,
      },
    ];

    const history = [
      {
        cycle: {
          _id: null,
          _creationTime: 1789480000000,
          ownerId: "kx7bhfswvbftcvze4zhzpcfzzd8ebgb7" as any,
          jobId: "kd76jzn457xdcj2rjnqzyhsnr98eb0wj" as any,
          cycleNumber: 1,
          briefVersion: 1,
          status: "active" as const, // Historical cycle having legacy status
          mandateSnapshot: {
            enabled: true,
            maxProviders: 3,
            allowInitialOutreach: true,
            allowRoutineClarifications: true,
            allowFollowUp: true,
            maxFollowUps: 1,
            preference: "balanced" as const,
            includePreviouslyContacted: false,
          },
          maxProviders: 3,
          createdAt: 1789480000000,
          updatedAt: 1789480500000,
        },
        briefVersion: 1,
        candidateCount: 0,
        outreachCount: 0,
        responseCount: 0,
        responses: [],
      },
      {
        cycle: {
          _id: "m57d34js0n889mvv560sntjnb98ekt12" as any,
          _creationTime: 1789481100000,
          ownerId: "kx7bhfswvbftcvze4zhzpcfzzd8ebgb7" as any,
          jobId: "kd76jzn457xdcj2rjnqzyhsnr98eb0wj" as any,
          cycleNumber: 2,
          briefVersion: 3,
          mandateSnapshot: {
            enabled: true,
            maxProviders: 3,
            allowInitialOutreach: true,
            allowRoutineClarifications: true,
            allowFollowUp: true,
            maxFollowUps: 1,
            preference: "balanced" as const,
            includePreviouslyContacted: false,
          },
          maxProviders: 3,
          startedAt: 1789481100000,
          endedAt: 1789481105000,
          status: "exhausted_no_options" as const,
          outcomeSummary: "No contactable providers found",
          recoveryEnabled: true,
          recoveryDiscoveryCycles: 2,
          createdAt: 1789481100000,
          updatedAt: 1789481105000,
        },
        briefVersion: 3,
        candidateCount: 5,
        outreachCount: 0,
        responseCount: 0,
        responses: [],
      },
    ];

    expect(productionCandidates.length).toBe(2);
    expect(productionCandidates[0].cycleId).toBe("m57d34js0n889mvv560sntjnb98ekt12");
    expect(productionCandidates[0].contactability).toBe("website_only");

    const html = renderToString(
      React.createElement(CycleHistoryBar, {
        history: history as any,
        selectedCycleNumber: 2,
        onSelectCycle: () => {},
      }),
    ).replace(/<!-- -->/g, "");

    expect(html).toContain("Procurement Cycles (2)");
    expect(html).toContain("Cycle 1");
    expect(html).toContain("v1");
    // Historical Cycle 1 MUST NOT render as "active"
    expect(html).toContain("previous attempt");
    expect(html).not.toMatch(/Cycle 1<\/span><span class="cycle-version-tag">\(v1\)<\/span><span class="contact-pill"[^>]*>active<\/span>/);

    // Current Cycle 2 MUST render its exhausted status
    expect(html).toContain("Cycle 2");
    expect(html).toContain("v3");
    expect(html).toContain("exhausted no options");
  });

  it("verifies process rail wording remains truthful for both contacted and zero-contactable outcomes", () => {
    // 1. Outcome where providers were contacted
    const contactedJob = {
      status: "outreach_sent" as const,
      briefApprovedAt: 1700000000000,
      autonomy: { approvedAt: 1700000000000, enabled: true },
    };
    const contactedSteps = getProcessRailSteps(contactedJob);
    expect(contactedSteps[3].label).toBe("Findor researches and contacts eligible providers");
    expect(contactedSteps[3].complete).toBe(true);

    // 2. Outcome where zero providers were contactable (job in needs_user state)
    const zeroContactableJob = {
      status: "needs_user" as const,
      briefApprovedAt: 1700000000000,
      autonomy: { approvedAt: 1700000000000, enabled: true },
    };
    const zeroSteps = getProcessRailSteps(zeroContactableJob);
    expect(zeroSteps[3].label).toBe("Findor researches and contacts eligible providers");
    expect(zeroSteps[3].complete).toBe(true); // Completed the research/contact phase truthfully
    expect(zeroSteps[4].complete).toBe(false); // No replies to review
  });

  it("renders CurrentStateHero correctly across all key operational states", () => {
    // 1. brief_ready
    const briefReadyJob = {
      _id: "job_1",
      status: "brief_ready" as const,
      currentBriefVersion: 2,
      serviceCategory: "Electrical",
      serviceLocation: "Austin, Texas",
    };
    const hero1 = renderToString(
      React.createElement(CurrentStateHero, {
        job: briefReadyJob as any,
        onApprove: () => {},
        onEditBrief: () => {},
        onTryAgain: () => {},
        onNewJob: () => {},
        isApproving: false,
        isZeroResult: false,
        isPartialResult: false,
        currentCycleEntry: null,
        error: null,
      }),
    );
    expect(hero1).toContain("Brief v2 Ready for Review");
    expect(hero1).toContain("Approve Operating Mandate");
    expect(hero1).toContain("Start finding options");

    // 2. researching
    const researchingJob = {
      _id: "job_2",
      status: "researching" as const,
      serviceCategory: "Plumbing",
      serviceLocation: "Toronto, Ontario",
    };
    const hero2 = renderToString(
      React.createElement(CurrentStateHero, {
        job: researchingJob as any,
        onApprove: () => {},
        onEditBrief: () => {},
        onTryAgain: () => {},
        onNewJob: () => {},
        isApproving: false,
        isZeroResult: false,
        isPartialResult: false,
        currentCycleEntry: null,
        error: null,
      }),
    );
    expect(hero2).toContain("Findor is researching local providers");
    expect(hero2).toContain("Live Research in progress");

    // 3. outreach_sent
    const outreachJob = {
      _id: "job_3",
      status: "outreach_sent" as const,
      serviceCategory: "Residential cleaning",
      serviceLocation: "Lagos, Nigeria",
    };
    const hero3 = renderToString(
      React.createElement(CurrentStateHero, {
        job: outreachJob as any,
        onApprove: () => {},
        onEditBrief: () => {},
        onTryAgain: () => {},
        onNewJob: () => {},
        isApproving: false,
        isZeroResult: false,
        isPartialResult: false,
        currentCycleEntry: null,
        error: null,
      }),
    );
    expect(hero3).toContain("Outreach sent · Waiting for replies");

    // 4. needs_user with zero result
    const zeroResultJob = {
      _id: "job_4",
      status: "needs_user" as const,
      serviceCategory: "Electrical",
      serviceLocation: "Austin, Texas",
    };
    const hero4 = renderToString(
      React.createElement(CurrentStateHero, {
        job: zeroResultJob as any,
        onApprove: () => {},
        onEditBrief: () => {},
        onTryAgain: () => {},
        onNewJob: () => {},
        isApproving: false,
        isZeroResult: true,
        isPartialResult: false,
        currentCycleEntry: null,
        error: null,
      }),
    );
    expect(hero4).toContain("No contactable providers found for this attempt");
    expect(hero4).toContain("Try again (New search)");
    expect(hero4).toContain("Edit request scope");
    expect(hero4).toContain("Start new job");

    // 5. paused
    const pausedJob = {
      _id: "job_5",
      status: "paused" as const,
      executionStatus: "paused" as const,
      serviceCategory: "HVAC",
      serviceLocation: "Seattle, Washington",
    };
    const hero5 = renderToString(
      React.createElement(CurrentStateHero, {
        job: pausedJob as any,
        onApprove: () => {},
        onEditBrief: () => {},
        onTryAgain: () => {},
        onNewJob: () => {},
        isApproving: false,
        isZeroResult: false,
        isPartialResult: false,
        currentCycleEntry: null,
        error: null,
      }),
    );
    expect(hero5).toContain("Request Paused");
    expect(hero5).toContain("All external research and outreach are on hold.");

    // 6. completed
    const completedJob = {
      _id: "job_6",
      status: "completed" as const,
      executionStatus: "completed" as const,
      serviceCategory: "Moving",
      serviceLocation: "Austin, Texas",
    };
    const hero6 = renderToString(
      React.createElement(CurrentStateHero, {
        job: completedJob as any,
        onApprove: () => {},
        onEditBrief: () => {},
        onTryAgain: () => {},
        onNewJob: () => {},
        isApproving: false,
        isZeroResult: false,
        isPartialResult: false,
        currentCycleEntry: null,
        error: null,
      }),
    );
    expect(hero6).toContain("Request completed");
  });

  it("renders MultiJobDashboard cleanly with multiple requests and start another card", () => {
    const jobs = [
      {
        _id: "job_1",
        serviceCategory: "Electrical",
        jobTitle: "Fix wiring and install GFCI",
        naturalLanguageDescription: "Wiring in garage needs repair.",
        serviceLocation: "Austin, Texas",
        desiredTiming: "Next week",
        status: "needs_user",
      },
      {
        _id: "job_2",
        serviceCategory: "Residential cleaning",
        jobTitle: "Home deep clean",
        naturalLanguageDescription: "Deep clean 3-bedroom apartment.",
        serviceLocation: "Lagos, Nigeria",
        desiredTiming: "Flexible",
        status: "outreach_sent",
      },
    ];

    const html = renderToString(
      React.createElement(MultiJobDashboard, {
        jobs: jobs as any,
        onSelectJob: () => {},
        onNewJob: () => {},
      }),
    );

    expect(html).toContain("Your local service requests");
    expect(html).toContain("Fix wiring and install GFCI");
    expect(html).toContain("Home deep clean");
    expect(html).toContain("Austin, Texas");
    expect(html).toContain("Lagos, Nigeria");
    expect(html).toContain("Start another request");
  });

  it("renders ProjectHub in brief_approved state with Ready to find providers and Find providers button", () => {
    const briefApprovedJob = {
      _id: "job_approved",
      jobTitle: "I need my 2 bedroom flat deep cleaned",
      naturalLanguageDescription: "I need my 2 bedroom flat deep cleaned",
      serviceCategory: "Cleaning",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      desiredTiming: "this_week",
      budgetOrContext: "Flexible",
      status: "brief_approved" as const,
      executionStatus: "active" as const,
      autonomy: {
        enabled: true,
        maxProviders: 3,
        allowInitialOutreach: true,
        allowRoutineClarifications: true,
        allowFollowUp: true,
        maxFollowUps: 1,
        preference: "balanced" as const,
      },
      brief: {
        projectSummary: "I need my 2 bedroom flat deep cleaned",
        serviceCategory: "Cleaning",
        requestedOutcome: "I need my 2 bedroom flat deep cleaned",
        serviceLocation: "Oshodi, Lagos, Nigeria",
        desiredTiming: "This week",
        budgetOrContext: "Flexible",
        structuredRequirements: [],
        unknowns: [],
      },
    };

    const html = renderToString(
      React.createElement(ProjectHub, {
        job: briefApprovedJob as any,
        briefDoc: null,
        candidates: [],
        outreachMessages: [],
        conversations: [],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    // brief_approved must render "Ready to find providers" card with "Start finding providers" button
    expect(html).toContain("Ready to find providers");
    expect(html).toContain("This week");
    expect(html).not.toContain("this_week");
    expect(html).toContain("Start finding providers");
    expect(html).toContain("Requirements &amp; permissions confirmed");
    // brief_approved must NOT falsely render "Finding suitable local providers"
    expect(html).not.toContain("Finding suitable local providers");
  });

  it("renders ProjectHub in researching state with Finding suitable local providers and spinner", () => {
    const researchingJob = {
      _id: "job_researching",
      jobTitle: "I need my 2 bedroom flat deep cleaned",
      naturalLanguageDescription: "I need my 2 bedroom flat deep cleaned",
      serviceCategory: "Cleaning",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      desiredTiming: "This week",
      budgetOrContext: "Flexible",
      status: "researching" as const,
      executionStatus: "active" as const,
      activeOperation: "provider_search" as const,
      autonomy: {
        enabled: true,
        maxProviders: 3,
        allowInitialOutreach: true,
        allowRoutineClarifications: true,
        allowFollowUp: true,
        maxFollowUps: 1,
        preference: "balanced" as const,
      },
    };

    const html = renderToString(
      React.createElement(ProjectHub, {
        job: researchingJob as any,
        briefDoc: null,
        candidates: [],
        outreachMessages: [],
        conversations: [],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    // researching state must render active provider finding message
    expect(html).toContain("Finding suitable local providers");
    expect(html).toContain("Checking public websites and verified business contacts in");
    expect(html).toContain("Oshodi, Lagos, Nigeria");
    // researching state must NOT render the "Ready to find providers" card
    expect(html).not.toContain("Ready to find providers");
  });

  it("renders ProjectsHome cards truthfully distinguishing brief_approved from researching", () => {
    const jobs = [
      {
        _id: "job_app",
        jobTitle: "Deep clean 2 bedroom flat",
        serviceCategory: "Cleaning",
        serviceLocation: "Oshodi, Lagos, Nigeria",
        status: "brief_approved",
        missingFields: [],
        brief: {
          projectSummary: "Deep clean 2 bedroom flat",
          serviceCategory: "Cleaning",
          requestedOutcome: "Deep clean 2 bedroom flat",
          serviceLocation: "Oshodi, Lagos, Nigeria",
          desiredTiming: "This week",
          budgetOrContext: "Flexible",
          structuredRequirements: [],
          unknowns: [],
        },
      },
      {
        _id: "job_res",
        jobTitle: "Fix electrical wiring",
        serviceCategory: "Electrical",
        serviceLocation: "Austin, Texas",
        status: "researching",
      },
    ];

    const html = renderToString(
      React.createElement(ProjectsHome, {
        jobs: jobs as any,
        onSelectJob: () => {},
        onStartNewRequest: () => {},
      }),
    );

    expect(html).toContain("Ready to find providers");
    expect(html).toContain("Start finding providers");
    expect(html).toContain("Finding providers");
    expect(html).toContain("View progress");
  });

  it("renders post-quote provider selection, continuation choices, and direct takeover handoff truthfully", () => {
    const candidate = {
      _id: "cand_spotless_1" as any,
      _creationTime: Date.now(),
      jobId: "job_1" as any,
      ownerId: "user_1" as any,
      name: "Spotless Cleaners Ltd",
      url: "https://spotlesscleaners.example.com",
      description: "Residential cleaning",
      entityType: "provider" as const,
      contactability: "email_found" as const,
      contactEmail: "info@spotlesscleaners.example.com",
    };

    const response = {
      _id: "resp_1" as any,
      _creationTime: Date.now(),
      jobId: "job_1" as any,
      ownerId: "user_1" as any,
      providerId: "cand_spotless_1" as any,
      outreachId: "outreach_1" as any,
      inboundMessageId: "inbound_1" as any,
      kind: "quote" as const,
      headlinePrice: "$140",
      priceQualifier: "exact" as const,
      availability: "Friday morning",
      included: ["All supplies", "2 bedroom flat"],
      excluded: ["Exterior windows"],
      notStated: [],
      unclear: [],
      assumptions: [],
      informationNeeded: [],
      importantNotes: [],
      evidenceText: "We can do Friday morning for $140 with supplies included.",
      summary: "Friday morning estimate for $140.",
      model: "openai-gpt-5.6-luna",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const baseJob = {
      _id: "job_1" as any,
      _creationTime: Date.now(),
      ownerId: "user_1" as any,
      jobTitle: "Deep clean 2 bedroom flat",
      naturalLanguageDescription: "Deep clean needed",
      serviceCategory: "Cleaning",
      serviceLocation: "Ikeja, Lagos, Nigeria",
      desiredTiming: "Friday",
      budgetOrContext: "$150",
      structuredRequirements: { rawDetails: "", keyDetails: [] },
      status: "reply_understood" as const,
      executionStatus: "active" as const,
      missingFields: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 1. Single quote: "1 quote received" (never called a comparison) with
    // "Continue with this provider" and "Find more options".
    const comparisonHtml = renderToString(
      React.createElement(ProjectHub, {
        job: baseJob,
        candidates: [candidate],
        outreachMessages: [],
        conversations: [{ message: {} as any, attachments: [], response }],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onSetContinuousRecovery: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onSelectProvider: async () => {},
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    expect(comparisonHtml).toContain("1 quote received");
    expect(comparisonHtml).not.toContain("Compare");
    expect(comparisonHtml).toContain("Spotless Cleaners Ltd");
    expect(comparisonHtml).toContain("$140");
    expect(comparisonHtml).toContain("Continue with this provider");
    expect(comparisonHtml).toContain("Find more options");
    expect(comparisonHtml).toContain("No automatic ranking");

    // 1b. Two quotes: comparison heading.
    const secondResponse = { ...response, _id: "resp_2" as any, providerId: "cand_other_1" as any };
    const otherCandidate = { ...candidate, _id: "cand_other_1" as any, name: "Other Cleaners Ltd" };
    const twoQuoteHtml = renderToString(
      React.createElement(ProjectHub, {
        job: baseJob,
        candidates: [candidate, otherCandidate],
        outreachMessages: [],
        conversations: [
          { message: {} as any, attachments: [], response },
          { message: {} as any, attachments: [], response: secondResponse },
        ],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onSelectProvider: async () => {},
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    expect(twoQuoteHtml).toContain("Compare 2 options");
    expect(twoQuoteHtml).toContain("Spotless Cleaners Ltd");
    expect(twoQuoteHtml).toContain("Other Cleaners Ltd");

    // 2. Provider selected, no continuationMode chosen: shows "How would you like to continue?"
    const choiceHtml = renderToString(
      React.createElement(ProjectHub, {
        job: { ...baseJob, selectedCandidateId: "cand_spotless_1" as any },
        candidates: [candidate],
        outreachMessages: [],
        conversations: [{ message: {} as any, attachments: [], response }],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onSelectProvider: async () => {},
        onSetContinuationMode: async () => {},
        onClearSelectedProvider: async () => {},
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    expect(choiceHtml).toContain("How would you like to continue?");
    expect(choiceHtml).toContain("Continue with Findor");
    expect(choiceHtml).toContain("I&#x27;ll take it from here");
    expect(choiceHtml).toContain("Choose a different provider");

    // 3. Continue with Findor mode: shows routine questions, input box, send question
    const findorAssistedHtml = renderToString(
      React.createElement(ProjectHub, {
        job: {
          ...baseJob,
          selectedCandidateId: "cand_spotless_1" as any,
          continuationMode: "findor_assisted",
        },
        candidates: [candidate],
        outreachMessages: [],
        conversations: [{ message: {} as any, attachments: [], response }],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onSelectProvider: async () => {},
        onSetContinuationMode: async () => {},
        onClearSelectedProvider: async () => {},
        onAskProviderQuestion: async () => ({ status: "sent" as const, question: "" }),
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    expect(findorAssistedHtml).toContain("Continuing with");
    expect(findorAssistedHtml).toContain("Spotless Cleaners Ltd");
    expect(findorAssistedHtml).toContain("Ask if Friday morning works");
    expect(findorAssistedHtml).toContain("Ask whether supplies are included");
    expect(findorAssistedHtml).toContain("Ask how long the job will take");
    expect(findorAssistedHtml).toContain("Send question");

    // 4. User Takeover mode: clean handoff with copy summary, email, website, mark done
    const userTakeoverHtml = renderToString(
      React.createElement(ProjectHub, {
        job: {
          ...baseJob,
          selectedCandidateId: "cand_spotless_1" as any,
          continuationMode: "user_takeover",
        },
        candidates: [candidate],
        outreachMessages: [],
        conversations: [{ message: {} as any, attachments: [], response }],
        events: [],
        onApproveBrief: async () => {},
        onStartResearch: async () => {},
        onEditBrief: () => {},
        onPauseJob: async () => {},
        onResumeJob: async () => {},
        onCancelJob: async () => {},
        onCompleteJob: async () => {},
        onRetryCycle: async () => {},
        onSelectProvider: async () => {},
        onSetContinuationMode: async () => {},
        onClearSelectedProvider: async () => {},
        onBackToProjects: () => {},
        onStartNewRequest: () => {},
      }),
    );

    expect(userTakeoverHtml).toContain("Direct Handoff Active");
    expect(userTakeoverHtml).toContain("Spotless Cleaners Ltd");
    expect(userTakeoverHtml).toContain("$140");
    expect(userTakeoverHtml).toContain("Friday morning");
    expect(userTakeoverHtml).toContain("All supplies");
    expect(userTakeoverHtml).toContain("info@spotlesscleaners.example.com");
    expect(userTakeoverHtml).toContain("Copy summary");
    expect(userTakeoverHtml).toContain("Open email");
    expect(userTakeoverHtml).toContain("Visit website");
    expect(userTakeoverHtml).toContain("Mark project done");
    expect(userTakeoverHtml).toContain("Let Findor help again");
  });

  describe("resolveConsumerProjectState - exhaustive matrix", () => {
    it("correctly resolves all 16 distinct consumer project states", () => {
      // 1. needs_details
      expect(resolveConsumerProjectState({ status: "needs_info" as any })).toBe("needs_details");

      // 2. ready_for_review (requires a real persisted brief)
      expect(
        resolveConsumerProjectState({
          status: "brief_ready" as any,
          missingFields: [],
          brief: { projectSummary: "x" } as any,
        }),
      ).toBe("ready_for_review");
      // Structural invariant: no brief -> no review/approval UI.
      expect(
        resolveConsumerProjectState({ status: "brief_ready" as any }),
      ).toBe("needs_details");
      expect(
        resolveConsumerProjectState({
          status: "brief_ready" as any,
          missingFields: ["A little more detail about what you need done"],
        }),
      ).toBe("needs_details");

      // 3. ready_to_search (requires a real persisted brief)
      expect(
        resolveConsumerProjectState({
          status: "brief_approved" as any,
          brief: { projectSummary: "x" } as any,
        }),
      ).toBe("ready_to_search");
      // Structural invariant: no brief -> no approval UI.
      expect(
        resolveConsumerProjectState({ status: "brief_approved" as any }),
      ).toBe("needs_details");

      // 4. researching
      expect(resolveConsumerProjectState({ status: "researching" as any })).toBe("researching");

      // 5. providers_ready
      expect(resolveConsumerProjectState({ status: "providers_ready" as any })).toBe("providers_ready");

      // 6. outreach_in_flight
      expect(resolveConsumerProjectState({ status: "outreach_approved" as any })).toBe("outreach_in_flight");

      // 7. waiting_for_replies
      expect(resolveConsumerProjectState({ status: "outreach_sent" as any })).toBe("waiting_for_replies");

      // 8. needs_decision (needs_user or failed)
      expect(resolveConsumerProjectState({ status: "needs_user" as any })).toBe("needs_decision");
      expect(resolveConsumerProjectState({ status: "failed" as any })).toBe("needs_decision");

      // 9. options_ready (reply received/understood or responses in context)
      expect(resolveConsumerProjectState({ status: "reply_understood" as any })).toBe("options_ready");
      expect(
        resolveConsumerProjectState(
          { status: "outreach_sent" as any },
          { responses: [{ _id: "res1" as any, jobId: "job1" as any, providerId: "p1" as any } as any] },
        ),
      ).toBe("options_ready");

      // 10. provider_selected (selected candidate with no mode)
      expect(
        resolveConsumerProjectState({
          status: "reply_understood" as any,
          selectedCandidateId: "cand1" as any,
        }),
      ).toBe("provider_selected");

      // 11. findor_assisted
      expect(
        resolveConsumerProjectState({
          status: "reply_understood" as any,
          selectedCandidateId: "cand1" as any,
          continuationMode: "findor_assisted",
        }),
      ).toBe("findor_assisted");

      // 12. user_takeover
      expect(
        resolveConsumerProjectState({
          status: "reply_understood" as any,
          selectedCandidateId: "cand1" as any,
          continuationMode: "user_takeover",
        }),
      ).toBe("user_takeover");

      // 13. paused (executionStatus: paused, status: paused, or pausedFromStatus)
      expect(resolveConsumerProjectState({ status: "paused" as any })).toBe("paused");
      expect(resolveConsumerProjectState({ status: "researching" as any, executionStatus: "paused" as any })).toBe("paused");
      expect(resolveConsumerProjectState({ status: "researching" as any, pausedFromStatus: "researching" as any })).toBe("paused");

      // 14. cancelled (status: cancelled or executionStatus: cancelled)
      expect(resolveConsumerProjectState({ status: "cancelled" as any })).toBe("cancelled");
      expect(resolveConsumerProjectState({ status: "researching" as any, executionStatus: "cancelled" as any })).toBe("cancelled");

      // 15. completed (status: completed or executionStatus: completed)
      expect(resolveConsumerProjectState({ status: "completed" as any })).toBe("completed");
      expect(resolveConsumerProjectState({ status: "outreach_sent" as any, executionStatus: "completed" as any })).toBe("completed");

      // 16. unknown_state (fallback for corrupted/null/unknown states)
      expect(resolveConsumerProjectState(null)).toBe("unknown_state");
      expect(resolveConsumerProjectState(undefined)).toBe("unknown_state");
      expect(resolveConsumerProjectState({ status: "corrupted_nonexistent_status" as any })).toBe("unknown_state");
    });
  });

  describe("ProjectHub - Non-empty rendering guarantee across all 16 states", () => {
    const dummyHandlers = {
      onApproveBrief: async () => {},
      onStartResearch: async () => {},
      onSetContinuousRecovery: async () => {},
      onEditBrief: () => {},
      onPauseJob: async () => {},
      onResumeJob: async () => {},
      onCancelJob: async () => {},
      onCompleteJob: async () => {},
      onRetryCycle: async () => {},
      onSelectProvider: async () => {},
      onSetContinuationMode: async () => {},
      onClearSelectedProvider: async () => {},
      onBackToProjects: () => {},
      onStartNewRequest: () => {},
    };

    const baseTestJob = {
      _id: "job_test_123" as any,
      _creationTime: Date.now(),
      ownerId: "user_123" as any,
      jobTitle: "I need my AC fixed",
      serviceCategory: "HVAC",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      structuredLocation: { city: "Lagos", country: "Nigeria", locality: "Oshodi" },
      desiredTiming: "this week",
      budgetOrContext: "Standard home service",
      naturalLanguageDescription: "My AC is leaking water and not cooling",
      missingFields: [] as string[],
      brief: {
        projectSummary: "I need my AC fixed: My AC is leaking water and not cooling",
        serviceCategory: "HVAC",
        requestedOutcome: "My AC is leaking water and not cooling",
        serviceLocation: "Oshodi, Lagos, Nigeria",
        desiredTiming: "this week",
        budgetOrContext: "Standard home service",
        structuredRequirements: [],
        unknowns: ["Exact fault/symptom", "AC type and number of units"],
      },
      executionStatus: "active" as const,
    };

    it("verifies the exact AC job (needs_info) renders a visible, non-empty 'A few details needed' card", () => {
      const acJob = {
        ...baseTestJob,
        status: "needs_info" as const,
        missingFields: ["A little more detail about what you need done"],
      };

      const html = renderToString(
        React.createElement(ProjectHub, {
          job: acJob as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );

      // Must never be blank
      expect(html).toContain("A few details needed to complete your brief");
      expect(html).toContain("Missing details:");
      expect(html).toContain("A little more detail about what you need done");
      expect(html).toContain("Provide details");
      expect(html).toContain("Start new request");
    });

    it("verifies all remaining 15 states render non-empty cards with expected actions", () => {
      const candItem = {
        _id: "cand_1" as any,
        _creationTime: Date.now(),
        jobId: "job_test_123" as any,
        ownerId: "user_123" as any,
        name: "CoolAir Lagos Ltd",
        url: "https://coolair.example.com",
        description: "HVAC contractor",
        entityType: "provider" as const,
        contactability: "email_found" as const,
        contactEmail: "info@coolair.example.com",
      };

      // 1. ready_for_review
      const briefReadyHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "brief_ready" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(briefReadyHtml).toContain("Review project summary &amp; start search");
      expect(briefReadyHtml).toContain("Approve &amp; start search");

      // 2. ready_to_search
      const briefApprovedHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "brief_approved" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(briefApprovedHtml).toContain("Ready to find providers");
      expect(briefApprovedHtml).toContain("Start finding providers");

      // 3. researching
      const researchingHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "researching" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(researchingHtml).toContain("Finding suitable local providers");

      // 4. providers_ready
      const providersReadyHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "providers_ready" as const } as any,
          candidates: [candItem],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(providersReadyHtml).toContain("Providers identified · Preparing outreach");

      // 5. outreach_in_flight
      const outreachApprovedHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "outreach_approved" as const } as any,
          candidates: [candItem],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(outreachApprovedHtml).toContain("Outreach approved · Sending inquiries");

      // 6. waiting_for_replies
      const outreachSentHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "outreach_sent" as const } as any,
          candidates: [candItem],
          outreachMessages: [{} as any],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(outreachSentHtml).toContain("Inquiries sent · Waiting for provider replies");

      // 7. needs_decision (zero-result)
      const zeroResultHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "needs_user" as const } as any,
          candidates: [candItem],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(zeroResultHtml).toContain("Needs your decision");
      expect(zeroResultHtml).toContain("Try again");

      // 8. paused
      const pausedHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "paused" as const, executionStatus: "paused" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(pausedHtml).toContain("Project paused");
      expect(pausedHtml).toContain("Resume project");

      // 9. cancelled
      const cancelledHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "cancelled" as const, executionStatus: "cancelled" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(cancelledHtml).toContain("Project cancelled");
      expect(cancelledHtml).toContain("Start new request");

      // 10. completed
      const completedHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "completed" as const, executionStatus: "completed" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(completedHtml).toContain("Project marked as complete");
      expect(completedHtml).toContain("Back to projects");

      // 11. unknown_state fallback (ensures corrupted state renders safe card instead of blank screen)
      const unknownHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "unknown_corrupted" as any } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(unknownHtml).toContain("Project status update");
      expect(unknownHtml).toContain("Your project is active");
      expect(unknownHtml).toContain("View activity");
      expect(unknownHtml).toContain("All projects");
    });

    it("never renders raw backend error tokens on intake or project surfaces", () => {
      const banned = [
        "CONVEX",
        "Request ID",
        "Server Error",
        "Called by client",
        "convex/",
        "node_modules",
      ];
      const intakeHtml = renderToString(
        React.createElement(ConversationalIntake, {
          initialPrompt: "Fix my AC",
          initialCategory: "hvac",
          onSubmitRequest: async () => {},
          onCancel: () => {},
        }),
      );
      // Intake presents backend-truth ordering: no invented permission screen.
      expect(intakeHtml).toContain("What do you need help with?");
      expect(intakeHtml).not.toContain("What Findor will do");
      for (const token of banned) {
        expect(intakeHtml).not.toContain(token);
      }
      expect(isSafeConsumerString(intakeHtml)).toBe(true);

      const hubHtml = renderToString(
        React.createElement(ProjectHub, {
          job: { ...baseTestJob, status: "needs_info" as const } as any,
          candidates: [],
          outreachMessages: [],
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      for (const token of banned) {
        expect(hubHtml).not.toContain(token);
      }
      expect(isSafeConsumerString(hubHtml)).toBe(true);
    });

    it("counts contacted providers truthfully across job history and by cycle", () => {
      const sent = (id: string, candidateId: string, extra: object = {}) => ({
        _id: id,
        candidateId,
        cycleId: "cycle_1",
        status: "sent",
        purpose: "initial",
        ...extra,
      });
      // 3 sent initials -> 3 providers contacted.
      expect(
        countContactedProviders(
          [sent("m1", "c1"), sent("m2", "c2"), sent("m3", "c3")],
        ),
      ).toBe(3);
      // 1 initial + 1 follow-up to the same provider -> still 1.
      expect(
        countContactedProviders(
          [
            sent("m1", "c1"),
            { _id: "f1", candidateId: "c1", cycleId: "cycle_1", status: "sent", purpose: "follow_up" },
          ],
        ),
      ).toBe(1);
      // Historical cycle rows remain truthful in the cumulative count.
      expect(
        countContactedProviders(
          [sent("m0", "c0", { cycleId: "cycle_0" }), sent("m1", "c1")],
        ),
      ).toBe(2);
      expect(
        countContactedProvidersInCycle(
          [sent("m0", "c0", { cycleId: "cycle_0" }), sent("m1", "c1")],
          "cycle_1",
        ),
      ).toBe(1);
      // Failed sends are never counted.
      expect(
        countContactedProviders(
          [
            sent("m1", "c1"),
            { _id: "m2", candidateId: "c2", cycleId: "cycle_1", status: "failed", purpose: "initial" },
          { _id: "m3", candidateId: "c3", cycleId: "cycle_1", status: "sending", purpose: "initial" },
          ],
        ),
      ).toBe(1);
      // Duplicate rows for one provider collapse to 1.
      expect(
        countContactedProviders([sent("m1", "c1"), sent("m2", "c1")]),
      ).toBe(1);
      expect(countContactedProviders([])).toBe(0);
      expect(countContactedProviders(null)).toBe(0);
    });

    it("renders the truthful contacted count on the waiting screen", () => {
      const waitingJob = {
        ...baseTestJob,
        status: "outreach_sent" as const,
        currentCycleId: "cycle_1" as any,
      };
      const messages = ["c1", "c2", "c3"].map((c, i) => ({
        _id: `m${i}` as any,
        _creationTime: Date.now(),
        jobId: "job_test_123" as any,
        ownerId: "user_123" as any,
        candidateId: c as any,
        cycleId: "cycle_1" as any,
        status: "sent" as const,
        purpose: "initial" as const,
        providerEmail: `${c}@example.test`,
        subject: "HVAC inquiry",
        body: "Hello",
      }));
      const html = renderToString(
        React.createElement(ProjectHub, {
          job: waitingJob as any,
          candidates: [],
          outreachMessages: messages,
          conversations: [],
          events: [],
          ...dummyHandlers,
        }),
      );
      expect(html).toContain("3 providers contacted so far.");
      expect(html).not.toContain("1 provider contacted so far.");
    });

    it("resolves provider-owned article pages to the evidence-backed business, never fabricating", () => {
      // Article-shaped row with same-domain brand evidence -> resolved business.
      expect(
        resolveBusinessDisplay({
          name: "List of HVAC Companies in Lagos And Their Address",
          url: "https://www.example-hvac.test/list-of-hvac-companies-in-lagos",
          description: "List of HVAC Companies in Lagos.",
          evidence: [
            { sourceUrl: "https://www.example-hvac.test/list-of-hvac-companies-in-lagos", claim: "List of HVAC Companies in Lagos." },
            {
              sourceUrl: "https://www.example-hvac.test/",
              claim: "Public business contact info@example-hvac.test appears in Firecrawl Markdown: [![Example HVAC Limited](https://www.example-hvac.test/logo.png)](https://www.example-hvac.test/)",
            },
          ],
        }),
      ).toEqual({
        name: "Example HVAC Limited",
        url: "https://www.example-hvac.test/",
        derived: true,
      });
      // Ordinary provider rows pass through untouched.
      const plain = {
        name: "HHH-Tec",
        url: "https://hhh-tec.example/heating-ventilation-air-conditioning-hvac-contractor/",
      };
      expect(resolveBusinessDisplay(plain)).toEqual({
        name: "HHH-Tec",
        url: "https://hhh-tec.example/heating-ventilation-air-conditioning-hvac-contractor/",
        derived: false,
      });
      // Article-shaped row WITHOUT brand evidence stays unchanged (no fabrication).
      expect(
        resolveBusinessDisplay({
          name: "List of Movers And Their Prices",
          url: "https://unknown-blog.example/top-movers",
          description: "A list of movers.",
          evidence: [],
        }),
      ).toEqual({
        name: "List of Movers And Their Prices",
        url: "https://unknown-blog.example/top-movers",
        derived: false,
      });
    });
  });
});

describe("continuous quote recovery UX", () => {
  const recoveryHandlers = {
    onApproveBrief: async () => {},
    onStartResearch: async () => {},
    onSetContinuousRecovery: async () => {},
    onEditBrief: () => {},
    onPauseJob: async () => {},
    onResumeJob: async () => {},
    onCancelJob: async () => {},
    onCompleteJob: async () => {},
    onRetryCycle: async () => {},
    onSelectProvider: async () => {},
    onBackToProjects: () => {},
    onStartNewRequest: () => {},
  };

  const recoveryBaseJob = {
    _id: "job_recovery_1" as any,
    _creationTime: Date.now(),
    ownerId: "user_1" as any,
    jobTitle: "Fix my AC",
    serviceCategory: "HVAC",
    serviceLocation: "Oshodi, Lagos, Nigeria",
    structuredLocation: { city: "Lagos", country: "Nigeria", locality: "Oshodi" },
    desiredTiming: "this week",
    budgetOrContext: "Flexible",
    naturalLanguageDescription: "Fix my AC",
    missingFields: [] as string[],
    brief: {
      projectSummary: "Fix my AC",
      serviceCategory: "HVAC",
      requestedOutcome: "Fix my AC",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      desiredTiming: "this week",
      budgetOrContext: "Flexible",
      structuredRequirements: [],
      unknowns: [],
    },
    executionStatus: "active" as const,
  };

  const sentMessages = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      _id: `m${i}` as any,
      _creationTime: Date.now(),
      jobId: "job_recovery_1" as any,
      ownerId: "user_1" as any,
      candidateId: `c${i}` as any,
      cycleId: "cycle_1" as any,
      status: "sent" as const,
      purpose: "initial" as const,
      providerEmail: `c${i}@example.test`,
      subject: "HVAC inquiry",
      body: "Hello",
    }));

  it("renders explicit quote-target, window, and auto-search controls before approval", () => {
    const html = renderToString(
      React.createElement(ProjectHub, {
        job: { ...recoveryBaseJob, status: "brief_ready" as const } as any,
        candidates: [],
        outreachMessages: [],
        conversations: [],
        events: [],
        ...recoveryHandlers,
      }),
    );
    expect(html).toContain("How many quotes would you like?");
    expect(html).toContain("How long should Findor wait before trying new providers?");
    expect(html).toContain("Keep looking automatically");
    expect(html).toContain("Approve &amp; start search");
  });

  it("shows waiting truth with deadline and stop controls while auto-search runs", () => {
    const html = renderToString(
      React.createElement(ProjectHub, {
        job: {
          ...recoveryBaseJob,
          status: "outreach_sent" as const,
          autonomy: {
            enabled: true,
            maxProviders: 3,
            allowInitialOutreach: true,
            allowRoutineClarifications: true,
            allowFollowUp: true,
            maxFollowUps: 1,
            preference: "balanced",
            approvedAt: Date.now(),
            quoteTarget: 3,
            responseWindowHours: 6,
            continuousRecoveryEnabled: true,
          },
          nextRecoveryAt: Date.now() + 6 * 3600_000,
        } as any,
        candidates: [],
        outreachMessages: sentMessages(3),
        conversations: [],
        events: [],
        ...recoveryHandlers,
      }),
    );
    expect(html).toContain("3 providers contacted so far.");
    expect(html).toContain("0 of 3 quotes received");
    expect(html).toContain("Change wait time");
    expect(html).toContain("Stop automatic searching");
  });

  it("offers explicit opt-in while auto-search is off", () => {
    const html = renderToString(
      React.createElement(ProjectHub, {
        job: {
          ...recoveryBaseJob,
          status: "outreach_sent" as const,
          autonomy: {
            enabled: true,
            maxProviders: 3,
            allowInitialOutreach: true,
            allowRoutineClarifications: true,
            allowFollowUp: true,
            maxFollowUps: 1,
            preference: "balanced",
            approvedAt: Date.now(),
            quoteTarget: 3,
            responseWindowHours: 24,
            continuousRecoveryEnabled: false,
          },
        } as any,
        candidates: [],
        outreachMessages: sentMessages(3),
        conversations: [],
        events: [],
        ...recoveryHandlers,
      }),
    );
    expect(html).toContain("3 providers contacted so far.");
    expect(html).toContain("Keep looking for more options");
    expect(html).not.toContain("Stop automatic searching");
  });

  it("keeps partial quotes visible with still-looking or find-more actions", () => {
    const quote = (id: string, providerId: string) => ({
      _id: id as any,
      _creationTime: Date.now(),
      jobId: "job_recovery_1" as any,
      ownerId: "user_1" as any,
      providerId: providerId as any,
      outreachId: "o1" as any,
      inboundMessageId: "i1" as any,
      kind: "quote" as const,
      headlinePrice: "$140",
      included: [],
      excluded: [],
      notStated: [],
      unclear: [],
      assumptions: [],
      informationNeeded: [],
      importantNotes: [],
      evidenceText: "We can fix your AC Friday for $140.",
      model: "fixture",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const cand = (id: string, name: string) => ({
      _id: id as any,
      _creationTime: Date.now(),
      jobId: "job_recovery_1" as any,
      ownerId: "user_1" as any,
      name,
      url: `https://${id}.example.test/`,
      description: "HVAC contractor",
      entityType: "provider" as const,
      contactability: "email_found" as const,
    });
    const withResponses = (responses: Array<{ response: unknown }>, autonomy: object) =>
      renderToString(
        React.createElement(ProjectHub, {
          job: {
            ...recoveryBaseJob,
            status: "reply_understood" as const,
            autonomy: {
              enabled: true,
              maxProviders: 3,
              allowInitialOutreach: true,
              allowRoutineClarifications: true,
              allowFollowUp: true,
              maxFollowUps: 1,
              preference: "balanced",
              approvedAt: Date.now(),
              quoteTarget: 3,
              responseWindowHours: 24,
              ...autonomy,
            },
          } as any,
          candidates: [cand("c1", "Alpha HVAC Ltd"), cand("c2", "Beta HVAC Ltd")],
          outreachMessages: [],
          conversations: responses.map((r, i) => ({
            message: {} as any,
            attachments: [],
            response: { ...quote(`r${i}`, i === 0 ? "c1" : "c2"), ...(r.response as object) },
          })),
          events: [],
          ...recoveryHandlers,
        }),
      );

    // 1 usable of 3 with auto-search on: visible immediately + still-looking line.
    const oneOn = withResponses([{ response: {} }], { continuousRecoveryEnabled: true });
    expect(oneOn).toContain("1 quote received");
    expect(oneOn).toContain("Findor is still looking for more options.");

    // 1 usable of 3 with auto-search off: find-more action offered.
    const oneOff = withResponses([{ response: {} }], { continuousRecoveryEnabled: false });
    expect(oneOff).toContain("1 quote received");
    expect(oneOff).toContain("Find more options");

    // 2 usable of 3: comparison heading, never forced to wait.
    const twoOff = withResponses([{ response: {} }, { response: {} }], {
      continuousRecoveryEnabled: false,
    });
    expect(twoOff).toContain("Compare 2 options");
    expect(twoOff).not.toContain("1 quote received");
  });
});
