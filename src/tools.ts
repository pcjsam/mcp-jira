import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { textToAdf } from "./adf.js";
import { DETAIL_FIELDS, LIST_FIELDS, issueDetail, issueRow } from "./format.js";
import { JiraClient, JiraError, type Transition } from "./jira.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (msg: string): ToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });

/** Wrap a handler so Jira/validation errors come back as tool errors, never as a crashed transport. */
function guard<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof JiraError) return fail(`${e.message} [${e.method} ${e.path}]`);
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

const ISSUE_KEY = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]+-\d+$/, "Issue key like PROJ-123")
  .describe("Issue key, e.g. PROJ-123.");

const BOARD_ID = z.number().int().positive().describe("Board id (from list_boards).");

const ASSIGNEE = z
  .string()
  .describe('Who to assign: "me", an email, a display name, or an Atlassian accountId. Use "unassigned" to clear.');

/** Quote a JQL string literal. */
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function registerTools(server: McpServer, jira: JiraClient) {
  // ---------------------------------------------------------------- boards

  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description:
        "List the Jira boards visible to the token's user, with id, name, type (scrum/kanban/simple) and the project each is anchored to. " +
        "Filter by name substring, project key or type. Board ids from here feed every board-scoped tool.",
      inputSchema: z.object({
        name: z.string().optional().describe("Case-insensitive substring of the board name."),
        project_key: z.string().optional().describe("Only boards whose location is this project, e.g. PLAT."),
        type: z.enum(["scrum", "kanban", "simple"]).optional().describe("Board type filter."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ name, project_key, type }) => {
      const boards = await jira.listBoards({ name, projectKeyOrId: project_key, type });
      return ok({
        count: boards.length,
        boards: boards.map((b) => ({
          id: b.id,
          name: b.name,
          type: b.type,
          project_key: b.location?.projectKey ?? null,
          project_name: b.location?.projectName ?? b.location?.displayName ?? null,
        })),
      });
    }),
  );

  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description:
        "Describe one board: its project, its columns and the workflow statuses each column maps to, and (scrum boards) the active and future sprints. " +
        "Use it before move_ticket to see the column names, and before create_ticket to learn the project key.",
      inputSchema: z.object({ board_id: BOARD_ID }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ board_id }) => {
      const [board, columns] = await Promise.all([jira.getBoard(board_id), jira.getBoardColumns(board_id)]);
      const statusIds = [...new Set(columns.flatMap((c) => c.statuses.map((s) => s.id)))];
      const statuses = await Promise.all(
        statusIds.map((id) => jira.getStatus(id).catch(() => ({ id, name: `status ${id}` }))),
      );
      const nameOf = new Map(statuses.map((s) => [s.id, s.name]));
      const sprints = board.type === "scrum" ? await jira.getBoardSprints(board_id, "active,future") : [];
      return ok({
        id: board.id,
        name: board.name,
        type: board.type,
        project_key: board.location?.projectKey ?? null,
        project_name: board.location?.projectName ?? null,
        columns: columns.map((c) => ({ name: c.name, statuses: c.statuses.map((s) => nameOf.get(s.id) ?? s.id) })),
        ...(board.type === "scrum"
          ? { sprints: sprints.map((s) => ({ id: s.id, name: s.name, state: s.state, start: s.startDate?.slice(0, 10), end: s.endDate?.slice(0, 10), goal: s.goal })) }
          : {}),
        url: `${jira.baseUrl}/jira/software/c/projects/${board.location?.projectKey ?? ""}/boards/${board.id}`,
      });
    }),
  );

  // ---------------------------------------------------------------- search / read

  server.registerTool(
    "search_tickets",
    {
      title: "Search tickets",
      description:
        "Find issues. Scope to one board with board_id (only issues that appear on that board) or leave it out to search the whole site, " +
        "e.g. everything assigned to someone across boards. Combine the structured filters (assignee, status, text, type, updated_since) " +
        "and/or pass raw JQL; filters are ANDed. Returns compact rows sorted by last update; use get_ticket for description and comments.",
      inputSchema: z.object({
        board_id: BOARD_ID.optional().describe("Restrict to issues shown on this board. Omit for a cross-board search."),
        assignee: z.string().optional().describe('Filter by assignee: "me", "unassigned", an email, display name or accountId.'),
        status: z.string().optional().describe('Status name, e.g. "In Progress", or a status category: "todo", "inprogress", "done".'),
        text: z.string().optional().describe("Free-text match on summary, description and comments."),
        issue_type: z.string().optional().describe('Issue type name, e.g. "Bug", "Story".'),
        updated_since: z.string().optional().describe('Only issues updated after this: a JQL relative date like "-7d", or YYYY-MM-DD.'),
        jql: z.string().optional().describe("Extra raw JQL, ANDed with the filters. May include its own ORDER BY."),
        limit: z.number().int().min(1).max(100).default(25).describe("Max rows per page."),
        page: z.string().optional().describe("Opaque cursor from a previous result's next_page to fetch the following page."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ board_id, assignee, status, text, issue_type, updated_since, jql, limit, page }) => {
      const clauses: string[] = [];
      if (assignee) {
        if (/^me$/i.test(assignee)) clauses.push("assignee = currentUser()");
        else if (/^unassigned$/i.test(assignee)) clauses.push("assignee is EMPTY");
        else clauses.push(`assignee = ${q(await jira.resolveAccountId(assignee))}`);
      }
      if (status) {
        const cat: Record<string, string> = { todo: "To Do", inprogress: "In Progress", done: "Done" };
        const key = status.toLowerCase().replace(/[\s_-]/g, "");
        clauses.push(cat[key] ? `statusCategory = ${q(cat[key])}` : `status = ${q(status)}`);
      }
      if (text) clauses.push(`text ~ ${q(text)}`);
      if (issue_type) clauses.push(`issuetype = ${q(issue_type)}`);
      if (updated_since) clauses.push(`updated >= ${q(updated_since)}`);

      let order = " ORDER BY updated DESC";
      let extra = jql?.trim() ?? "";
      const m = /\border\s+by\b/i.exec(extra);
      if (m) {
        order = " " + extra.slice(m.index);
        extra = extra.slice(0, m.index).trim();
      }
      if (extra) clauses.push(`(${extra})`);
      const where = clauses.join(" AND ");
      const finalJql = (where || (board_id ? "" : "created >= -30d")) + order;

      if (board_id) {
        const startAt = page ? Number(page) : 0;
        const res = await jira.boardIssues(board_id, { jql: finalJql.trim(), fields: LIST_FIELDS, startAt, maxResults: limit });
        const rows = res.issues.map((i) => issueRow(jira, i));
        const next = res.total !== undefined && startAt + rows.length < res.total ? String(startAt + rows.length) : undefined;
        return ok({ board_id, jql: finalJql.trim(), total: res.total, showing: rows.length, ...(next ? { next_page: next } : {}), issues: rows });
      }
      const res = await jira.searchIssues({ jql: finalJql.trim(), fields: LIST_FIELDS, maxResults: limit, nextPageToken: page });
      const rows = res.issues.map((i) => issueRow(jira, i));
      return ok({ jql: finalJql.trim(), showing: rows.length, ...(res.nextPageToken && !res.isLast ? { next_page: res.nextPageToken } : {}), issues: rows });
    }),
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get ticket",
      description:
        "Fetch one issue in full: fields, description as plain text, subtasks, links and the most recent comments. " +
        "Use search_tickets to find keys.",
      inputSchema: z.object({
        key: ISSUE_KEY,
        comment_limit: z.number().int().min(0).max(100).default(20).describe("How many of the newest comments to include."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ key, comment_limit }) => {
      const issue = await jira.getIssue(key, DETAIL_FIELDS);
      return ok(issueDetail(jira, issue, comment_limit));
    }),
  );

  server.registerTool(
    "find_users",
    {
      title: "Find users",
      description:
        "Look up Jira users by name or email to get their accountId. Only needed when a name is ambiguous; " +
        "the assignee fields on other tools already accept names and emails directly.",
      inputSchema: z.object({ query: z.string().min(1).describe("Part of a display name or an email address.") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ query }) => {
      const users = await jira.searchUsers(query);
      return ok(users.map((u) => ({ account_id: u.accountId, name: u.displayName, email: u.emailAddress ?? null, active: u.active, type: u.accountType })));
    }),
  );

  // ---------------------------------------------------------------- write

  server.registerTool(
    "create_ticket",
    {
      title: "Create ticket",
      description:
        "Create an issue in a board's project (pass board_id) or directly in a project (pass project_key). " +
        "Description accepts plain text with light markdown: blank-line paragraphs, '- ' bullets, '# ' headings, ``` code fences. " +
        "Returns the new key and URL.",
      inputSchema: z.object({
        board_id: BOARD_ID.optional().describe("Board whose project the issue goes in. Either this or project_key is required."),
        project_key: z.string().optional().describe("Project key, e.g. PLAT. Overrides the board's project if both are given."),
        summary: z.string().min(1).max(255).describe("One-line title."),
        description: z.string().optional().describe("Body text (see description formatting note)."),
        issue_type: z.string().default("Task").describe('Issue type name, e.g. "Task", "Bug", "Story", "Sub-task".'),
        assignee: ASSIGNEE.optional(),
        priority: z.string().optional().describe('Priority name, e.g. "High".'),
        labels: z.array(z.string()).optional().describe("Labels to apply (no spaces allowed in a label)."),
        parent_key: ISSUE_KEY.optional().describe("Parent issue (epic, or the parent of a sub-task)."),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date, YYYY-MM-DD."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async (a) => {
      let projectKey = a.project_key;
      if (!projectKey) {
        if (!a.board_id) return fail("Pass board_id or project_key.");
        const board = await jira.getBoard(a.board_id);
        projectKey = board.location?.projectKey;
        if (!projectKey) return fail(`Board ${a.board_id} is not anchored to a single project; pass project_key explicitly.`);
      }
      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        summary: a.summary,
        issuetype: { name: a.issue_type },
      };
      if (a.description) fields.description = textToAdf(a.description);
      if (a.assignee) fields.assignee = /^unassigned$/i.test(a.assignee) ? null : { accountId: await jira.resolveAccountId(a.assignee) };
      if (a.priority) fields.priority = { name: a.priority };
      if (a.labels) fields.labels = a.labels;
      if (a.parent_key) fields.parent = { key: a.parent_key };
      if (a.due_date) fields.duedate = a.due_date;

      try {
        const created = await jira.createIssue(fields);
        return ok({ key: created.key, url: jira.browseUrl(created.key), project_key: projectKey, issue_type: a.issue_type });
      } catch (e) {
        if (e instanceof JiraError && /issuetype/i.test(e.message)) {
          const types = await jira.getProjectIssueTypes(projectKey).catch(() => []);
          return fail(`${e.message}. Issue types in ${projectKey}: ${types.join(", ") || "unknown"}`);
        }
        throw e;
      }
    }),
  );

  server.registerTool(
    "update_ticket",
    {
      title: "Update ticket",
      description:
        "Edit fields on an existing issue: summary, description (replaced, not appended), assignee, priority, labels, parent, due date. " +
        "Does not change status; use move_ticket for that. Pass only the fields to change.",
      inputSchema: z.object({
        key: ISSUE_KEY,
        summary: z.string().min(1).max(255).optional(),
        description: z.string().optional().describe("Replaces the whole description. Same formatting as create_ticket."),
        assignee: ASSIGNEE.optional(),
        priority: z.string().optional().describe('Priority name, e.g. "Medium".'),
        labels: z.array(z.string()).optional().describe("Replaces the full label set."),
        add_labels: z.array(z.string()).optional().describe("Labels to add, keeping existing ones."),
        remove_labels: z.array(z.string()).optional().describe("Labels to remove."),
        parent_key: ISSUE_KEY.nullable().optional().describe("New parent, or null to detach."),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("Due date YYYY-MM-DD, or null to clear."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const fields: Record<string, unknown> = {};
      if (a.summary !== undefined) fields.summary = a.summary;
      if (a.description !== undefined) fields.description = textToAdf(a.description);
      if (a.assignee !== undefined) fields.assignee = /^unassigned$/i.test(a.assignee) ? null : { accountId: await jira.resolveAccountId(a.assignee) };
      if (a.priority !== undefined) fields.priority = { name: a.priority };
      if (a.parent_key !== undefined) fields.parent = a.parent_key === null ? null : { key: a.parent_key };
      if (a.due_date !== undefined) fields.duedate = a.due_date;
      if (a.labels !== undefined) fields.labels = a.labels;
      else if (a.add_labels || a.remove_labels) {
        const current: string[] = (await jira.getIssue(a.key, ["labels"])).fields.labels ?? [];
        const next = new Set(current);
        for (const l of a.add_labels ?? []) next.add(l);
        for (const l of a.remove_labels ?? []) next.delete(l);
        fields.labels = [...next];
      }
      if (Object.keys(fields).length === 0) return fail("Nothing to update: pass at least one field.");
      await jira.updateIssue(a.key, fields);
      return ok({ key: a.key, updated: Object.keys(fields), url: jira.browseUrl(a.key) });
    }),
  );

  server.registerTool(
    "move_ticket",
    {
      title: "Move ticket",
      description:
        "Move an issue to another board column / workflow status by name (e.g. \"In Progress\", \"Done\"). " +
        "Matches the target against the transition names, the destination status names and, when board_id is given, the board's column names. " +
        "Fails listing the transitions currently available when nothing matches. Optionally leaves a comment.",
      inputSchema: z.object({
        key: ISSUE_KEY,
        to: z.string().min(1).describe("Target column, status or transition name. Case-insensitive."),
        board_id: BOARD_ID.optional().describe("Board whose column names should also be accepted for `to`."),
        comment: z.string().optional().describe("Comment to add after the move."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ key, to, board_id, comment }) => {
      const transitions = await jira.getTransitions(key);
      const want = to.trim().toLowerCase();
      const eq = (s?: string) => (s ?? "").trim().toLowerCase() === want;

      let match: Transition | undefined =
        transitions.find((t) => eq(t.to?.name)) ?? transitions.find((t) => eq(t.name));

      if (!match && board_id) {
        const columns = await jira.getBoardColumns(board_id);
        const col = columns.find((c) => eq(c.name));
        if (col) {
          const ids = new Set(col.statuses.map((s) => s.id));
          match = transitions.find((t) => ids.has(t.to?.id));
        }
      }

      if (!match) {
        const current = (await jira.getIssue(key, ["status"])).fields.status?.name;
        const avail = transitions.map((t) => `  "${t.name}" → ${t.to?.name}`).join("\n");
        return fail(`No transition from "${current}" matches "${to}" on ${key}. Available:\n${avail || "  (none)"}`);
      }

      await jira.transitionIssue(key, match.id);
      let commentId: string | undefined;
      if (comment) commentId = (await jira.addComment(key, textToAdf(comment))).id;
      return ok({ key, transition: match.name, status: match.to?.name, ...(commentId ? { comment_id: commentId } : {}), url: jira.browseUrl(key) });
    }),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description:
        "Post a comment on an issue. Same light-markdown formatting as create_ticket descriptions; bare URLs become links.",
      inputSchema: z.object({
        key: ISSUE_KEY,
        body: z.string().min(1).describe("Comment text."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async ({ key, body }) => {
      const c = await jira.addComment(key, textToAdf(body));
      return ok({ key, comment_id: c.id, created: c.created, url: `${jira.browseUrl(key)}?focusedCommentId=${c.id}` });
    }),
  );

  server.registerTool(
    "delete_ticket",
    {
      title: "Delete ticket",
      description:
        "Permanently delete an issue. Irreversible: Jira has no trash for issues. Fails if the issue has sub-tasks unless delete_subtasks is true. " +
        "Prefer move_ticket to a Done/Cancelled status when the history should be kept.",
      inputSchema: z.object({
        key: ISSUE_KEY,
        delete_subtasks: z.boolean().default(false).describe("Also delete the issue's sub-tasks."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    guard(async ({ key, delete_subtasks }) => {
      const before = await jira.getIssue(key, ["summary", "subtasks"]);
      await jira.deleteIssue(key, delete_subtasks);
      return ok({ deleted: key, summary: before.fields.summary, subtasks_deleted: delete_subtasks ? (before.fields.subtasks ?? []).map((s: any) => s.key) : [] });
    }),
  );
}
