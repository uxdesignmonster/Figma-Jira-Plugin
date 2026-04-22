import type { BackendErrorCode } from "@figma-jira/shared-types";

/**
 * Base error for everything the Jira layer throws. Routes catch these and
 * map them to the `{ ok: false, error: { code, message } }` envelope.
 */
export abstract class JiraClientError extends Error {
  abstract readonly code: BackendErrorCode;
  abstract readonly httpStatus: number;
}

export class NotAuthenticatedError extends JiraClientError {
  readonly code = "unauthenticated";
  readonly httpStatus = 401;
  constructor(message = "Not connected to Jira.") {
    super(message);
  }
}

export class ReauthRequiredError extends JiraClientError {
  readonly code = "reauth_required";
  readonly httpStatus = 401;
  constructor(message = "Jira session expired. Reconnect to continue.") {
    super(message);
  }
}

export class NotFoundError extends JiraClientError {
  readonly code = "not_found";
  readonly httpStatus = 404;
  constructor(message = "Issue not found.") {
    super(message);
  }
}

export class UpstreamError extends JiraClientError {
  readonly code = "upstream_error";
  readonly httpStatus = 502;
  constructor(message = "Jira request failed.") {
    super(message);
  }
}

export class BadRequestError extends JiraClientError {
  readonly code = "bad_request";
  readonly httpStatus = 400;
  constructor(message = "Invalid request.") {
    super(message);
  }
}

export class LinkNotFoundError extends JiraClientError {
  readonly code = "link_not_found";
  readonly httpStatus = 404;
  constructor(message = "Widget link not found.") {
    super(message);
  }
}
