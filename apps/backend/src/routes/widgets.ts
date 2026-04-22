import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import type {
  BackendError,
  RegisterWidgetRequest,
  RegisterWidgetResponse,
  RefreshWidgetResponse,
  WidgetStatusResponse,
} from "@figma-jira/shared-types";
import type { FreshnessService } from "../jira/freshness.js";
import { toLinkSummary } from "../jira/freshness.js";
import { BadRequestError, JiraClientError } from "../jira/errors.js";

type Deps = { freshness: FreshnessService };

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof JiraClientError) {
    const body: { ok: false; error: BackendError } = {
      ok: false,
      error: { code: err.code, message: err.message },
    };
    res.status(err.httpStatus).json(body);
    return;
  }
  console.error("[widgets] unexpected error:", err);
  const fallback: { ok: false; error: BackendError } = {
    ok: false,
    error: { code: "upstream_error", message: "Unexpected server error." },
  };
  res.status(500).json(fallback);
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new BadRequestError(`Missing ${name}`);
  }
  return v;
}

function optionalString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function parseRegisterBody(body: unknown): RegisterWidgetRequest {
  if (!body || typeof body !== "object") {
    throw new BadRequestError("Missing request body");
  }
  const b = body as Record<string, unknown>;
  return {
    installationId: requireString(b.installationId, "installationId"),
    widgetNodeId: requireString(b.widgetNodeId, "widgetNodeId"),
    widgetId: requireString(b.widgetId, "widgetId"),
    fileKey: optionalString(b.fileKey),
    fileName: optionalString(b.fileName),
    issueId: requireString(b.issueId, "issueId"),
    issueKey: requireString(b.issueKey, "issueKey"),
    issueUpdatedAt: typeof b.issueUpdatedAt === "string" ? b.issueUpdatedAt : "",
  };
}

export function createWidgetsRouter({ freshness }: Deps): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      try {
        const payload = parseRegisterBody(req.body);
        const link = await freshness.registerWidget(payload);
        const body: RegisterWidgetResponse = {
          ok: true,
          link: toLinkSummary(link),
        };
        res.status(201).json(body);
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  router.get(
    "/:linkId/status",
    asyncHandler(async (req, res) => {
      try {
        const linkId = requireString(req.params.linkId, "linkId");
        const link = await freshness.getLinkStatus(linkId);
        const body: WidgetStatusResponse = {
          ok: true,
          link: toLinkSummary(link),
        };
        res.json(body);
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  router.post(
    "/:linkId/refresh",
    asyncHandler(async (req, res) => {
      try {
        const linkId = requireString(req.params.linkId, "linkId");
        const { ticket, link } = await freshness.refreshLink(linkId);
        const body: RefreshWidgetResponse = {
          ok: true,
          ticket,
          link: toLinkSummary(link),
        };
        res.json(body);
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  router.delete(
    "/:linkId",
    asyncHandler(async (req, res) => {
      try {
        const linkId = requireString(req.params.linkId, "linkId");
        await freshness.deleteLink(linkId);
        res.status(204).end();
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  return router;
}
