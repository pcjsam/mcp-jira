#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { JiraClient } from "./jira.js";
import { registerTools } from "./tools.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    // stderr only: stdout is the MCP wire.
    console.error(
      `mcp-jira: missing ${name}. Set JIRA_BASE_URL (https://<site>.atlassian.net), JIRA_EMAIL and JIRA_API_TOKEN ` +
        `(create one at https://id.atlassian.com/manage-profile/security/api-tokens).`,
    );
    process.exit(1);
  }
  return v;
}

const jira = new JiraClient({
  baseUrl: requireEnv("JIRA_BASE_URL"),
  email: requireEnv("JIRA_EMAIL"),
  apiToken: requireEnv("JIRA_API_TOKEN"),
});

const server = new McpServer(
  { name: "mcp-jira", version: "1.0.0" },
  {
    instructions:
      "Jira Cloud for this team. Start from list_boards to get board ids; search_tickets with board_id scopes to a board, " +
      "without it searches the whole site. Descriptions and comments are plain text with light markdown.",
  },
);

registerTools(server, jira);

const transport = new StdioServerTransport();
await server.connect(transport);
