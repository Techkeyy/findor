import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import { v } from "convex/values";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.optional(v.string()),
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AGENTMAIL_INBOX_ID: v.optional(v.string()),
    AUTH_RESET_INBOX_ID: v.optional(v.string()),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
  },
});

app.use(staticHosting);

export default app;
