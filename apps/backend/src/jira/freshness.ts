import { randomUUID } from "node:crypto";
import type {
  JiraTicketSummary,
  RegisterWidgetRequest,
  WidgetLinkSummary,
} from "@figma-jira/shared-types";
import type { JiraClient } from "./client.js";
import type {
  WidgetLink,
  WidgetLinkStore,
} from "../storage/widgetLinkStore.js";
import type {
  IssueSnapshot,
  IssueSnapshotStore,
} from "../storage/issueSnapshotStore.js";
import { BadRequestError, LinkNotFoundError } from "./errors.js";
import { hashTicket } from "./snapshotHash.js";

type Deps = {
  links: WidgetLinkStore;
  snapshots: IssueSnapshotStore;
  jira: JiraClient;
};

/**
 * Central place for "what does this installation know about this issue?" and
 * the fresh/stale lifecycle. Routes + webhooks both call into this so the
 * same rules apply regardless of who triggered the update.
 */
export class FreshnessService {
  constructor(private readonly deps: Deps) {}

  /**
   * Idempotent: if a link already exists for (installationId, widgetNodeId),
   * update its issue fields rather than creating a second row. This keeps
   * state clean when a user re-seeds the same widget with a different ticket.
   */
  async registerWidget(req: RegisterWidgetRequest): Promise<WidgetLink> {
    requireNonEmpty("installationId", req.installationId);
    requireNonEmpty("widgetNodeId", req.widgetNodeId);
    requireNonEmpty("widgetId", req.widgetId);
    requireNonEmpty("issueId", req.issueId);
    requireNonEmpty("issueKey", req.issueKey);

    const now = new Date().toISOString();
    const existing = await this.deps.links.findByNode(
      req.installationId,
      req.widgetNodeId,
    );

    const link: WidgetLink = existing
      ? {
          ...existing,
          widgetId: req.widgetId,
          fileKey: req.fileKey,
          fileName: req.fileName,
          issueId: req.issueId,
          issueKey: req.issueKey,
          lastSyncedAt: now,
          lastKnownIssueUpdatedAt: req.issueUpdatedAt || now,
          isStale: false,
        }
      : {
          linkId: randomUUID(),
          installationId: req.installationId,
          widgetNodeId: req.widgetNodeId,
          widgetId: req.widgetId,
          fileKey: req.fileKey,
          fileName: req.fileName,
          issueId: req.issueId,
          issueKey: req.issueKey,
          lastSyncedAt: now,
          lastKnownIssueUpdatedAt: req.issueUpdatedAt || now,
          isStale: false,
          createdAt: Date.now(),
        };

    await this.deps.links.save(link);
    return link;
  }

  async getLinkStatus(linkId: string): Promise<WidgetLink> {
    const link = await this.deps.links.getById(linkId);
    if (!link) throw new LinkNotFoundError();
    return link;
  }

  async deleteLink(linkId: string): Promise<void> {
    const link = await this.deps.links.getById(linkId);
    if (!link) throw new LinkNotFoundError();
    await this.deps.links.delete(linkId);
  }

  /**
   * Fetch the issue from Jira using the link's own installation tokens,
   * update the snapshot, clear the stale flag. This is the only path that
   * ever clears `isStale` — webhooks can set it but only the owning user's
   * refresh proves we're back in sync.
   */
  async refreshLink(
    linkId: string,
  ): Promise<{ ticket: JiraTicketSummary; link: WidgetLink }> {
    const link = await this.deps.links.getById(linkId);
    if (!link) throw new LinkNotFoundError();

    const ticket = await this.deps.jira.getIssueByKey(
      link.installationId,
      link.issueKey,
    );

    await this.upsertSnapshot(ticket);

    const now = new Date().toISOString();
    const updated: WidgetLink = {
      ...link,
      issueId: ticket.issueId,
      issueKey: ticket.issueKey,
      lastSyncedAt: now,
      lastKnownIssueUpdatedAt: ticket.updatedAt || now,
      isStale: false,
    };
    await this.deps.links.save(updated);
    return { ticket, link: updated };
  }

  /**
   * Called from the webhook handler after an event has been deduped. Compares
   * the incoming ticket snapshot against what we last knew; if anything
   * user-visible changed, we update the snapshot and mark every linked
   * widget for this issue stale.
   *
   * Returns the set of link ids that were transitioned from fresh → stale.
   */
  async onIssueChanged(incoming: JiraTicketSummary): Promise<string[]> {
    const prev = await this.deps.snapshots.getByIssueId(incoming.issueId);
    const nextHash = hashTicket(incoming);
    if (prev && prev.payloadHash === nextHash) {
      // Same rendered output — nothing for users to refresh.
      return [];
    }
    await this.upsertSnapshot(incoming);

    const links = await this.deps.links.listByIssueId(incoming.issueId);
    const transitioned: string[] = [];
    for (const link of links) {
      if (link.isStale) continue;
      const marked: WidgetLink = { ...link, isStale: true };
      await this.deps.links.save(marked);
      transitioned.push(link.linkId);
    }
    return transitioned;
  }

  private async upsertSnapshot(ticket: JiraTicketSummary): Promise<void> {
    const snapshot: IssueSnapshot = {
      issueId: ticket.issueId,
      issueKey: ticket.issueKey,
      ticket,
      payloadHash: hashTicket(ticket),
      fetchedAt: Date.now(),
    };
    await this.deps.snapshots.save(snapshot);
  }
}

export function toLinkSummary(link: WidgetLink): WidgetLinkSummary {
  return {
    linkId: link.linkId,
    widgetNodeId: link.widgetNodeId,
    issueId: link.issueId,
    issueKey: link.issueKey,
    lastSyncedAt: link.lastSyncedAt,
    lastKnownIssueUpdatedAt: link.lastKnownIssueUpdatedAt,
    isStale: link.isStale,
  };
}

function requireNonEmpty(name: string, value: string | null | undefined): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`Missing ${name}`);
  }
}
