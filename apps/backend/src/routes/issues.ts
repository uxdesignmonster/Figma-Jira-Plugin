import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import type {
  BackendError,
  GetIssueResponse,
  SearchIssuesResponse,
} from "@figma-jira/shared-types";
import type { JiraClient } from "../jira/client.js";
import { BadRequestError, JiraClientError } from "../jira/errors.js";

type Deps = { jiraClient: JiraClient };

const MIN_QUERY_LENGTH = 2;

function getQueryParam(req: Request, name: string): string | null {
  const v = req.query[name];
  return typeof v === "string" && v.length > 0 ? v : null;
}

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
  console.error("[issues] unexpected error:", err);
  const fallback: { ok: false; error: BackendError } = {
    ok: false,
    error: { code: "upstream_error", message: "Unexpected server error." },
  };
  res.status(500).json(fallback);
}

function requireInstallationId(req: Request): string {
  const id = getQueryParam(req, "installationId");
  if (!id) throw new BadRequestError("Missing installationId");
  return id;
}

export function createIssuesRouter({ jiraClient }: Deps): Router {
  const router = Router();

  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      try {
        const installationId = requireInstallationId(req);
        const q = (getQueryParam(req, "q") ?? "").trim();
        if (q.length < MIN_QUERY_LENGTH) {
          const empty: SearchIssuesResponse = { ok: true, tickets: [] };
          res.json(empty);
          return;
        }
        const tickets = await jiraClient.searchIssues(installationId, q);
        const body: SearchIssuesResponse = { ok: true, tickets };
        res.json(body);
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  router.get(
    "/:issueKey",
    asyncHandler(async (req, res) => {
      try {
        const installationId = requireInstallationId(req);
        const issueKey = req.params.issueKey;
        if (!issueKey) throw new BadRequestError("Missing issueKey");
        const ticket = await jiraClient.getIssueByKey(
          installationId,
          issueKey.toUpperCase(),
        );
        const body: GetIssueResponse = { ok: true, ticket };
        res.json(body);
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  return router;
}
