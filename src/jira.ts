/**
 * Thin Jira Cloud client: REST v3 (/rest/api/3) for issues, users and comments,
 * Agile 1.0 (/rest/agile/1.0) for boards and board-scoped issue queries.
 * Auth is basic (Atlassian account email + API token).
 */

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export interface Board {
  id: number;
  name: string;
  type: string;
  location?: {
    projectId?: number;
    projectKey?: string;
    projectName?: string;
    displayName?: string;
  };
}

export interface BoardColumn {
  name: string;
  statuses: { id: string; self: string }[];
}

export interface Sprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface Transition {
  id: string;
  name: string;
  to: { id: string; name: string; statusCategory?: { name: string } };
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
  accountType?: string;
}

export interface Issue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

/** An issue link type as Jira defines it: the name plus the phrases for each direction. */
export interface IssueLinkType {
  id: string;
  name: string;
  /** Phrase seen from the outward issue, e.g. "blocks". */
  outward: string;
  /** Phrase seen from the inward issue, e.g. "is blocked by". */
  inward: string;
}

export interface SearchPage {
  issues: Issue[];
  total?: number;
  isLast?: boolean;
  nextPageToken?: string;
  startAt?: number;
  maxResults?: number;
}

export class JiraClient {
  private readonly authHeader: string;
  readonly baseUrl: string;

  constructor(config: JiraConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authHeader =
      "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  }

  browseUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  // ---- transport -------------------------------------------------------------

  async request<T = any>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new JiraError(describeError(res.status, text), res.status, method, path);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ---- users -----------------------------------------------------------------

  myself(): Promise<JiraUser> {
    return this.request<JiraUser>("GET", "/rest/api/3/myself");
  }

  searchUsers(query: string, maxResults = 20): Promise<JiraUser[]> {
    return this.request<JiraUser[]>("GET", "/rest/api/3/user/search", {
      query: { query, maxResults },
    });
  }

  /**
   * Turn "me", an email, a display name or a raw accountId into an accountId.
   * Throws with the candidate list when the input is ambiguous.
   */
  async resolveAccountId(input: string): Promise<string> {
    const trimmed = input.trim();
    if (/^me$/i.test(trimmed)) return (await this.myself()).accountId;
    // Atlassian accountIds: 24 hex chars, or "<digits>:<uuid>"
    if (/^[0-9a-f]{24}$/i.test(trimmed) || /^\d+:[0-9a-f-]{36}$/i.test(trimmed)) {
      return trimmed;
    }
    const users = (await this.searchUsers(trimmed)).filter((u) => u.active);
    if (users.length === 1) return users[0].accountId;
    const lower = trimmed.toLowerCase();
    const exact = users.filter(
      (u) =>
        u.emailAddress?.toLowerCase() === lower || u.displayName.toLowerCase() === lower,
    );
    if (exact.length === 1) return exact[0].accountId;
    if (users.length === 0) {
      throw new Error(`No active Jira user matches "${input}". Try find_users with a different query.`);
    }
    const list = users
      .slice(0, 10)
      .map((u) => `  ${u.displayName}${u.emailAddress ? ` <${u.emailAddress}>` : ""} (${u.accountId})`)
      .join("\n");
    throw new Error(`"${input}" matches ${users.length} users; pass the accountId instead:\n${list}`);
  }

  // ---- boards (Agile API) ----------------------------------------------------

  async listBoards(filter: { name?: string; projectKeyOrId?: string; type?: string } = {}, cap = 200): Promise<Board[]> {
    const out: Board[] = [];
    let startAt = 0;
    for (;;) {
      const page = await this.request<{ values: Board[]; isLast: boolean }>(
        "GET",
        "/rest/agile/1.0/board",
        { query: { startAt, maxResults: 50, ...filter } },
      );
      out.push(...page.values);
      startAt += page.values.length;
      if (page.isLast || page.values.length === 0 || out.length >= cap) break;
    }
    return out;
  }

  getBoard(boardId: number): Promise<Board> {
    return this.request<Board>("GET", `/rest/agile/1.0/board/${boardId}`);
  }

  async getBoardColumns(boardId: number): Promise<BoardColumn[]> {
    const cfg = await this.request<{ columnConfig?: { columns: BoardColumn[] } }>(
      "GET",
      `/rest/agile/1.0/board/${boardId}/configuration`,
    );
    return cfg.columnConfig?.columns ?? [];
  }

  async getBoardSprints(boardId: number, state: string): Promise<Sprint[]> {
    try {
      const page = await this.request<{ values: Sprint[] }>(
        "GET",
        `/rest/agile/1.0/board/${boardId}/sprint`,
        { query: { state, maxResults: 20 } },
      );
      return page.values;
    } catch (e) {
      // Kanban boards have no sprints: Jira answers 400 here.
      if (e instanceof JiraError && e.status === 400) return [];
      throw e;
    }
  }

  getStatus(id: string): Promise<{ id: string; name: string; statusCategory?: { name: string } }> {
    return this.request("GET", `/rest/api/3/status/${id}`);
  }

  /** Issues visible on a board, filtered by (a subset of) JQL. Offset-paginated. */
  boardIssues(
    boardId: number,
    opts: { jql?: string; fields: string[]; startAt?: number; maxResults?: number },
  ): Promise<SearchPage> {
    return this.request<SearchPage>("GET", `/rest/agile/1.0/board/${boardId}/issue`, {
      query: {
        jql: opts.jql,
        fields: opts.fields.join(","),
        startAt: opts.startAt ?? 0,
        maxResults: opts.maxResults ?? 50,
      },
    });
  }

  // ---- issues ----------------------------------------------------------------

  /** Site-wide JQL search (the token-paginated /search/jql endpoint). */
  searchIssues(opts: { jql: string; fields: string[]; maxResults?: number; nextPageToken?: string }): Promise<SearchPage> {
    return this.request<SearchPage>("POST", "/rest/api/3/search/jql", {
      body: {
        jql: opts.jql,
        fields: opts.fields,
        maxResults: opts.maxResults ?? 50,
        nextPageToken: opts.nextPageToken,
      },
    });
  }

  getIssue(key: string, fields: string[], expand?: string): Promise<Issue> {
    return this.request<Issue>("GET", `/rest/api/3/issue/${key}`, {
      query: { fields: fields.join(","), expand },
    });
  }

  createIssue(fields: Record<string, unknown>): Promise<{ id: string; key: string }> {
    return this.request("POST", "/rest/api/3/issue", { body: { fields } });
  }

  updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
    return this.request("PUT", `/rest/api/3/issue/${key}`, { body: { fields } });
  }

  deleteIssue(key: string, deleteSubtasks: boolean): Promise<void> {
    return this.request("DELETE", `/rest/api/3/issue/${key}`, {
      query: { deleteSubtasks },
    });
  }

  async getTransitions(key: string): Promise<Transition[]> {
    const res = await this.request<{ transitions: Transition[] }>(
      "GET",
      `/rest/api/3/issue/${key}/transitions`,
    );
    return res.transitions;
  }

  transitionIssue(key: string, transitionId: string): Promise<void> {
    return this.request("POST", `/rest/api/3/issue/${key}/transitions`, {
      body: { transition: { id: transitionId } },
    });
  }

  addComment(key: string, body: unknown): Promise<{ id: string; created: string }> {
    return this.request("POST", `/rest/api/3/issue/${key}/comment`, { body: { body } });
  }

  // ---- issue links -----------------------------------------------------------

  async getIssueLinkTypes(): Promise<IssueLinkType[]> {
    const res = await this.request<{ issueLinkTypes: IssueLinkType[] }>("GET", "/rest/api/3/issueLinkType");
    return res.issueLinkTypes;
  }

  /** Create a link; `outward` is the issue the link is read from (for "Blocks", the blocker). */
  linkIssues(typeName: string, outward: string, inward: string, comment?: unknown): Promise<void> {
    return this.request("POST", "/rest/api/3/issueLink", {
      body: {
        type: { name: typeName },
        outwardIssue: { key: outward },
        inwardIssue: { key: inward },
        ...(comment ? { comment: { body: comment } } : {}),
      },
    });
  }

  async getProjectIssueTypes(projectKey: string): Promise<string[]> {
    const p = await this.request<{ issueTypes?: { name: string; subtask: boolean }[] }>(
      "GET",
      `/rest/api/3/project/${projectKey}`,
    );
    return (p.issueTypes ?? []).map((t) => t.name);
  }
}

/** Flatten Jira's error envelope ({errorMessages:[], errors:{field:msg}}) into one line. */
function describeError(status: number, text: string): string {
  let detail = text.slice(0, 500);
  try {
    const j = JSON.parse(text);
    const parts: string[] = [];
    if (Array.isArray(j.errorMessages)) parts.push(...j.errorMessages);
    if (j.errors && typeof j.errors === "object") {
      for (const [k, v] of Object.entries(j.errors)) parts.push(`${k}: ${v}`);
    }
    if (j.message) parts.push(j.message);
    if (parts.length) detail = parts.join("; ");
  } catch {
    /* not JSON */
  }
  const hint =
    status === 401
      ? " (check JIRA_EMAIL / JIRA_API_TOKEN)"
      : status === 403
        ? " (the token's user lacks permission)"
        : status === 404
          ? " (not found, or not visible to this user)"
          : "";
  return `Jira ${status}${hint}: ${detail}`;
}
