import { Router, type RequestHandler } from "express";
import type { WebhookProcessor, JiraWebhookBody } from "../jira/webhooks.js";

type Deps = { processor: WebhookProcessor };

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Jira issue webhooks. This endpoint is intentionally permissive: we always
 * 200 OK so Atlassian doesn't retry indefinitely on events we don't care
 * about. Processing errors are logged but still ack'd — retries would deliver
 * the same unhandled payload.
 */
export function createWebhooksRouter({ processor }: Deps): Router {
  const router = Router();

  router.post(
    "/jira",
    asyncHandler(async (req, res) => {
      const body = req.body as JiraWebhookBody;
      try {
        const result = await processor.process(body ?? {});
        if (result.status === "accepted") {
          console.log(
            `[webhook] accepted ${body?.webhookEvent} issue=${body?.issue?.key} marked-stale=${result.transitionedLinkIds.length}`,
          );
        } else if (result.status === "duplicate") {
          console.log(
            `[webhook] duplicate ${body?.webhookEvent} issue=${body?.issue?.key}`,
          );
        } else {
          console.log(`[webhook] ignored: ${result.reason}`);
        }
        res.status(200).json({ ok: true, result });
      } catch (err) {
        console.error("[webhook] processing error:", err);
        res.status(200).json({ ok: false });
      }
    }),
  );

  return router;
}
