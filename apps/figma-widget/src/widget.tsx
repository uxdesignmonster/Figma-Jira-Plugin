import type { JiraTicketSummary } from "@figma-jira/shared-types";

const { widget } = figma;
const { AutoLayout, Text, useSyncedState } = widget;

function TicketWidget() {
  const [ticket] = useSyncedState<JiraTicketSummary | null>("ticket", null);

  return (
    <AutoLayout
      direction="vertical"
      padding={16}
      spacing={8}
      cornerRadius={8}
      fill="#FFFFFF"
      stroke="#E5E7EB"
      width={320}
    >
      <Text fontSize={12} fill="#6B7280">
        {ticket ? ticket.issueKey : "No ticket selected"}
      </Text>
      <Text fontSize={14} fontWeight="bold">
        {ticket ? ticket.summary : "Jira Ticket"}
      </Text>
      <Text fontSize={12} fill="#6B7280">
        {ticket ? `Status: ${ticket.status}` : "Phase 0 — scaffold placeholder"}
      </Text>
    </AutoLayout>
  );
}

widget.register(TicketWidget);
