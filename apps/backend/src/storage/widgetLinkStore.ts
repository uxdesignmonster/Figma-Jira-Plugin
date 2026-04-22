/**
 * A widget link is the backend's mirror of a Figma WidgetNode that has been
 * seeded with a Jira ticket. Keys chosen carefully:
 *
 * - `widgetNodeId` is the Figma canvas node id (unique per WidgetNode, stable
 *   across sessions). A cloned widget gets a *new* node id, so clones register
 *   as new links next time they refresh. We do not attempt transparent
 *   cloning support in this phase — see README for current behavior.
 * - `installationId` is our opaque per-Figma-user token stored in
 *   `figma.clientStorage`. It maps 1:1 to a saved Jira connection.
 * - `fileKey` comes from `figma.fileKey`, which is `undefined` in some
 *   contexts (e.g. draft files). We store whatever Figma gives us.
 */
export type WidgetLink = {
  linkId: string;
  installationId: string;
  widgetNodeId: string;
  widgetId: string;
  fileKey: string | null;
  fileName: string | null;
  issueId: string;
  issueKey: string;
  lastSyncedAt: string;
  lastKnownIssueUpdatedAt: string;
  isStale: boolean;
  createdAt: number;
};

export interface WidgetLinkStore {
  save(link: WidgetLink): Promise<void>;
  getById(linkId: string): Promise<WidgetLink | null>;
  findByNode(
    installationId: string,
    widgetNodeId: string,
  ): Promise<WidgetLink | null>;
  listByIssueId(issueId: string): Promise<WidgetLink[]>;
  listByIssueKey(issueKey: string): Promise<WidgetLink[]>;
  delete(linkId: string): Promise<void>;
}

export class InMemoryWidgetLinkStore implements WidgetLinkStore {
  private readonly byId = new Map<string, WidgetLink>();

  async save(link: WidgetLink): Promise<void> {
    this.byId.set(link.linkId, link);
  }

  async getById(linkId: string): Promise<WidgetLink | null> {
    return this.byId.get(linkId) ?? null;
  }

  async findByNode(
    installationId: string,
    widgetNodeId: string,
  ): Promise<WidgetLink | null> {
    for (const link of this.byId.values()) {
      if (
        link.installationId === installationId &&
        link.widgetNodeId === widgetNodeId
      ) {
        return link;
      }
    }
    return null;
  }

  async listByIssueId(issueId: string): Promise<WidgetLink[]> {
    const out: WidgetLink[] = [];
    for (const link of this.byId.values()) {
      if (link.issueId === issueId) out.push(link);
    }
    return out;
  }

  async listByIssueKey(issueKey: string): Promise<WidgetLink[]> {
    const out: WidgetLink[] = [];
    for (const link of this.byId.values()) {
      if (link.issueKey === issueKey) out.push(link);
    }
    return out;
  }

  async delete(linkId: string): Promise<void> {
    this.byId.delete(linkId);
  }
}
