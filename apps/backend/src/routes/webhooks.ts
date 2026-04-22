import { timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import type { WebhookProcessor, JiraWebhookBody } from "../jira/webhooks.js";

type Deps = {
  processor: WebhookProcessor;
  webhookSecret: string | null;
};

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Constant-time compare so an attacker can't byte-by-byte probe the secret.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Jira issue webhooks. Path-embedded secret is our trust anchor: Jira Cloud
 * OAuth-app webhooks do not support HMAC signatures, so we rely on an
 * unguessable URL that only our Jira app registration knows. Deployments
 * MUST set `JIRA_WEBHOOK_SECRET`; dev mode (secret unset) is allowed but
 * logs a loud warning at startup.
 */
export function createWebhooksRouter({
  processor,
  webhookSecret,
}: Deps): Router {
  const router = Router();

  router.post(
    "/jira/:secret?",
    asyncHandler(async (req, res) => {
      // Security check first — reject before doing any payload work.
      if (webhookSecret) {
        const provided = req.params.secret ?? "";
        if (!safeEqual(provided, webhookSecret)) {
          // Generic 404 — don't leak whether the path is "a webhook path".
          res.status(404).end();
          return;
        }
      }

      // Structure validation: reject payloads we definitely can't process.
      const body = req.body as unknown;
      if (!isPlainObject(body)) {
        res.status(400).json({ ok: false, error: "invalid body" });
        return;
      }

      try {
        const result = await processor.process(body as JiraWebhookBody);
        const ev = (body as JiraWebhookBody).webhookEvent;
        const key = (body as JiraWebhookBody).issue?.key;
        if (result.status === "accepted") {
          console.log(
            `[webhook] accepted ${ev} issue=${key} marked-stale=${result.transitionedLinkIds.length}`,
          );
        } else if (result.status === "duplicate") {
          console.log(`[webhook] duplicate ${ev} issue=${key}`);
        } else {
          console.log(`[webhook] ignored: ${result.reason}`);
        }
        res.status(200).json({ ok: true, result });
      } catch (err) {
        console.error("[webhook] processing error:", err);
        // Still 200 so Atlassian doesn't retry with the same unprocessable
        // payload forever — unprocessable events are logged for inspection.
        res.status(200).json({ ok: false });
      }
    }),
  );

  return router;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
