import { describe, expect, it } from "@jest/globals";
import { DETAIL_FIELDS, LIST_FIELDS, issueDetail, issueRow } from "../src/format.js";
import { JiraClient, type Issue } from "../src/jira.js";

// The client constructor is pure (it only normalises the base url and encodes
// the auth header), so a real instance is the most faithful way to get browseUrl.
const jira = new JiraClient({ baseUrl: "https://acme.atlassian.net/", email: "e@x.y", apiToken: "t" });

const adfDoc = (text: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const fullIssue = (): Issue => ({
  id: "10001",
  key: "PROJ-42",
  fields: {
    summary: "Fix the login flow",
    status: { name: "In Progress", id: "3" },
    issuetype: { name: "Bug", id: "1" },
    priority: { name: "High", id: "2" },
    assignee: { displayName: "Sam Doe", accountId: "acc-1", emailAddress: "s@x.y" },
    reporter: { displayName: "Alex Roe", accountId: "acc-2" },
    labels: ["auth", "backend"],
    parent: { key: "PROJ-1", fields: { summary: "Epic" } },
    duedate: "2024-06-30",
    created: "2024-01-02T10:30:45.123+0000",
    updated: "2024-02-03T14:05:09.000+0000",
  },
});

// ================================================================ field lists

describe("LIST_FIELDS / DETAIL_FIELDS", () => {
  it("LIST_FIELDS contains exactly the fields issueRow reads", () => {
    expect(LIST_FIELDS).toEqual([
      "summary",
      "status",
      "issuetype",
      "priority",
      "assignee",
      "reporter",
      "labels",
      "parent",
      "duedate",
      "created",
      "updated",
    ]);
  });

  it("DETAIL_FIELDS starts with every LIST_FIELDS entry in order", () => {
    expect(DETAIL_FIELDS.slice(0, LIST_FIELDS.length)).toEqual(LIST_FIELDS);
  });

  it("DETAIL_FIELDS adds the fields issueDetail reads", () => {
    for (const f of ["description", "comment", "subtasks", "issuelinks", "components", "fixVersions", "resolution"]) {
      expect(DETAIL_FIELDS).toContain(f);
    }
  });

  it("neither list has duplicates", () => {
    expect(new Set(LIST_FIELDS).size).toBe(LIST_FIELDS.length);
    expect(new Set(DETAIL_FIELDS).size).toBe(DETAIL_FIELDS.length);
  });
});

// ================================================================ issueRow

describe("issueRow", () => {
  it("flattens a fully populated issue", () => {
    expect(issueRow(jira, fullIssue())).toEqual({
      key: "PROJ-42",
      summary: "Fix the login flow",
      status: "In Progress",
      type: "Bug",
      priority: "High",
      assignee: "Sam Doe",
      reporter: "Alex Roe",
      labels: ["auth", "backend"],
      parent: "PROJ-1",
      due: "2024-06-30",
      created: "2024-01-02",
      updated: "2024-02-03 14:05",
      url: "https://acme.atlassian.net/browse/PROJ-42",
    });
  });

  it("builds the browse url from the client base url without a double slash", () => {
    const row = issueRow(jira, fullIssue());
    expect(row.url).toBe("https://acme.atlassian.net/browse/PROJ-42");
    expect(row.url).not.toContain("net//");
  });

  it("uses a different client's base url", () => {
    const other = new JiraClient({ baseUrl: "https://other.example.com", email: "e", apiToken: "t" });
    expect(issueRow(other, fullIssue()).url).toBe("https://other.example.com/browse/PROJ-42");
  });

  it("falls back to nulls and empties when fields is missing entirely", () => {
    const issue = { id: "1", key: "X-1" } as unknown as Issue;
    expect(issueRow(jira, issue)).toEqual({
      key: "X-1",
      summary: "",
      status: null,
      type: null,
      priority: null,
      assignee: null,
      reporter: null,
      labels: [],
      created: null,
      updated: null,
      url: "https://acme.atlassian.net/browse/X-1",
    });
  });

  it("falls back to nulls and empties when fields is an empty object", () => {
    const row = issueRow(jira, { id: "1", key: "X-1", fields: {} });
    expect(row.summary).toBe("");
    expect(row.status).toBeNull();
    expect(row.type).toBeNull();
    expect(row.priority).toBeNull();
    expect(row.assignee).toBeNull();
    expect(row.reporter).toBeNull();
    expect(row.labels).toEqual([]);
    expect(row.created).toBeNull();
    expect(row.updated).toBeNull();
  });

  it("treats explicit null field values like missing ones", () => {
    const row = issueRow(jira, {
      id: "1",
      key: "X-1",
      fields: {
        summary: null,
        status: null,
        issuetype: null,
        priority: null,
        assignee: null,
        reporter: null,
        labels: null,
        parent: null,
        duedate: null,
        created: null,
        updated: null,
      },
    });
    expect(row).toEqual({
      key: "X-1",
      summary: "",
      status: null,
      type: null,
      priority: null,
      assignee: null,
      reporter: null,
      labels: [],
      created: null,
      updated: null,
      url: "https://acme.atlassian.net/browse/X-1",
    });
  });

  it("omits the parent key when there is no parent", () => {
    const row = issueRow(jira, { id: "1", key: "X-1", fields: {} });
    expect(row).not.toHaveProperty("parent");
  });

  it("omits the parent key when the parent object has no key", () => {
    const row = issueRow(jira, { id: "1", key: "X-1", fields: { parent: { fields: {} } } });
    expect(row).not.toHaveProperty("parent");
  });

  it("omits due when duedate is missing, null or empty", () => {
    expect(issueRow(jira, { id: "1", key: "X-1", fields: {} })).not.toHaveProperty("due");
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { duedate: null } })).not.toHaveProperty("due");
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { duedate: "" } })).not.toHaveProperty("due");
  });

  it("keeps the summary as-is, including whitespace", () => {
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { summary: "  spaced  " } }).summary).toBe("  spaced  ");
  });

  it("keeps an empty labels array", () => {
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { labels: [] } }).labels).toEqual([]);
  });

  it("returns the same labels array reference it was given", () => {
    const labels = ["a"];
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { labels } }).labels).toBe(labels);
  });

  it("truncates created to the date portion", () => {
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { created: "2024-12-31T23:59:59.999+0100" } }).created).toBe(
      "2024-12-31",
    );
  });

  it("formats updated as date and time to the minute with a space separator", () => {
    expect(issueRow(jira, { id: "1", key: "X-1", fields: { updated: "2024-12-31T23:59:59.999+0100" } }).updated).toBe(
      "2024-12-31 23:59",
    );
  });

  it("does not choke on short timestamp strings", () => {
    const row = issueRow(jira, { id: "1", key: "X-1", fields: { created: "2024", updated: "2024-01-02" } });
    expect(row.created).toBe("2024");
    expect(row.updated).toBe("2024-01-02");
  });

  it("does not read the description or comments", () => {
    const row = issueRow(jira, { id: "1", key: "X-1", fields: { description: adfDoc("x"), comment: { comments: [] } } });
    expect(row).not.toHaveProperty("description");
    expect(row).not.toHaveProperty("comments");
  });
});

// ================================================================ issueDetail

describe("issueDetail", () => {
  const comment = (id: string, text: string, author?: string, created?: string) => ({
    id,
    ...(author ? { author: { displayName: author, accountId: `acc-${id}` } } : {}),
    ...(created ? { created } : {}),
    body: adfDoc(text),
  });

  const detailIssue = (): Issue => {
    const issue = fullIssue();
    issue.fields = {
      ...issue.fields,
      description: adfDoc("The login page returns 401."),
      resolution: { name: "Fixed" },
      components: [{ name: "web", id: "1" }, { name: "api", id: "2" }],
      fixVersions: [{ name: "1.2.0" }, { name: "1.3.0" }],
      subtasks: [
        { key: "PROJ-43", fields: { summary: "Sub one", status: { name: "Done" } } },
        { key: "PROJ-44", fields: { summary: "Sub two", status: { name: "To Do" } } },
      ],
      issuelinks: [
        { type: { name: "Blocks", outward: "blocks", inward: "is blocked by" }, outwardIssue: { key: "PROJ-10", fields: { summary: "Downstream", status: { name: "Open" } } } },
        { type: { name: "Blocks", outward: "blocks", inward: "is blocked by" }, inwardIssue: { key: "PROJ-9", fields: { summary: "Upstream", status: { name: "Done" } } } },
      ],
      comment: {
        total: 3,
        comments: [
          comment("c1", "first", "Ann", "2024-01-01T09:00:00.000+0000"),
          comment("c2", "second", "Bob", "2024-01-02T10:15:30.000+0000"),
          comment("c3", "third", "Cat", "2024-01-03T11:45:00.000+0000"),
        ],
      },
    };
    return issue;
  };

  it("includes every issueRow field", () => {
    const issue = detailIssue();
    const detail = issueDetail(jira, issue, 20);
    expect(detail).toMatchObject(issueRow(jira, issue));
  });

  it("flattens a fully populated issue", () => {
    expect(issueDetail(jira, detailIssue(), 20)).toEqual({
      key: "PROJ-42",
      summary: "Fix the login flow",
      status: "In Progress",
      type: "Bug",
      priority: "High",
      assignee: "Sam Doe",
      reporter: "Alex Roe",
      labels: ["auth", "backend"],
      parent: "PROJ-1",
      due: "2024-06-30",
      created: "2024-01-02",
      updated: "2024-02-03 14:05",
      url: "https://acme.atlassian.net/browse/PROJ-42",
      assignee_account_id: "acc-1",
      resolution: "Fixed",
      components: ["web", "api"],
      fix_versions: ["1.2.0", "1.3.0"],
      description: "The login page returns 401.",
      subtasks: [
        { key: "PROJ-43", summary: "Sub one", status: "Done" },
        { key: "PROJ-44", summary: "Sub two", status: "To Do" },
      ],
      links: [
        { relation: "blocks", key: "PROJ-10", summary: "Downstream", status: "Open" },
        { relation: "is blocked by", key: "PROJ-9", summary: "Upstream", status: "Done" },
      ],
      comments_total: 3,
      comments: [
        { id: "c1", author: "Ann", created: "2024-01-01 09:00", body: "first" },
        { id: "c2", author: "Bob", created: "2024-01-02 10:15", body: "second" },
        { id: "c3", author: "Cat", created: "2024-01-03 11:45", body: "third" },
      ],
    });
  });

  describe("defaults for missing data", () => {
    it("handles an issue with no fields at all", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1" } as unknown as Issue, 5);
      expect(detail).toEqual({
        key: "X-1",
        summary: "",
        status: null,
        type: null,
        priority: null,
        assignee: null,
        reporter: null,
        labels: [],
        created: null,
        updated: null,
        url: "https://acme.atlassian.net/browse/X-1",
        assignee_account_id: null,
        resolution: null,
        components: [],
        fix_versions: [],
        description: "",
        subtasks: [],
        links: [],
        comments_total: 0,
        comments: [],
      });
    });

    it("handles explicit nulls for the detail-only fields", () => {
      const detail = issueDetail(jira, {
        id: "1",
        key: "X-1",
        fields: {
          assignee: null,
          resolution: null,
          components: null,
          fixVersions: null,
          description: null,
          subtasks: null,
          issuelinks: null,
          comment: null,
        },
      }, 5);
      expect(detail.assignee_account_id).toBeNull();
      expect(detail.resolution).toBeNull();
      expect(detail.components).toEqual([]);
      expect(detail.fix_versions).toEqual([]);
      expect(detail.description).toBe("");
      expect(detail.subtasks).toEqual([]);
      expect(detail.links).toEqual([]);
      expect(detail.comments_total).toBe(0);
      expect(detail.comments).toEqual([]);
    });

    it("returns null assignee_account_id when the assignee has no accountId", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { assignee: { displayName: "Anon" } } }, 5);
      expect(detail.assignee).toBe("Anon");
      expect(detail.assignee_account_id).toBeNull();
    });
  });

  describe("description", () => {
    it("converts an ADF description to text", () => {
      const fields = {
        description: {
          type: "doc",
          version: 1,
          content: [
            { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Why" }] },
            { type: "paragraph", content: [{ type: "text", text: "Because ", marks: [] }, { type: "text", text: "reasons", marks: [{ type: "strong" }] }] },
          ],
        },
      };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).description).toBe("# Why\n\nBecause **reasons**");
    });

    it("passes a legacy string description through unchanged", () => {
      expect(issueDetail(jira, { id: "1", key: "X-1", fields: { description: "h1. Old *wiki*" } }, 5).description).toBe(
        "h1. Old *wiki*",
      );
    });

    it("returns an empty string for an empty ADF doc", () => {
      const fields = { description: { type: "doc", version: 1, content: [] } };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).description).toBe("");
    });
  });

  describe("components and fix versions", () => {
    it("maps to name lists", () => {
      const fields = { components: [{ name: "a" }, { name: "b" }], fixVersions: [{ name: "v1" }] };
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields }, 5);
      expect(detail.components).toEqual(["a", "b"]);
      expect(detail.fix_versions).toEqual(["v1"]);
    });

    it("keeps undefined entries when an item has no name", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { components: [{ id: "1" }] } }, 5);
      expect(detail.components).toEqual([undefined]);
    });
  });

  describe("subtasks", () => {
    it("maps key, summary and status", () => {
      const fields = { subtasks: [{ key: "X-2", fields: { summary: "s", status: { name: "Done" } } }] };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).subtasks).toEqual([
        { key: "X-2", summary: "s", status: "Done" },
      ]);
    });

    it("tolerates subtasks without fields", () => {
      const fields = { subtasks: [{ key: "X-2" }] };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).subtasks).toEqual([
        { key: "X-2", summary: undefined, status: undefined },
      ]);
    });

    it("tolerates subtasks with fields but no status", () => {
      const fields = { subtasks: [{ key: "X-2", fields: { summary: "s" } }] };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).subtasks).toEqual([
        { key: "X-2", summary: "s", status: undefined },
      ]);
    });
  });

  describe("links", () => {
    const link = (dir: "outwardIssue" | "inwardIssue", extra: Record<string, unknown> = {}) => ({
      type: { name: "Relates", outward: "relates to", inward: "is related to" },
      [dir]: { key: "Y-1", fields: { summary: "Other", status: { name: "Open" } } },
      ...extra,
    });

    it("uses the outward relation name for outward links", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { issuelinks: [link("outwardIssue")] } }, 5);
      expect(detail.links).toEqual([{ relation: "relates to", key: "Y-1", summary: "Other", status: "Open" }]);
    });

    it("uses the inward relation name for inward links", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { issuelinks: [link("inwardIssue")] } }, 5);
      expect(detail.links).toEqual([{ relation: "is related to", key: "Y-1", summary: "Other", status: "Open" }]);
    });

    it("prefers the outward issue when both are present", () => {
      const both = {
        type: { outward: "out", inward: "in" },
        outwardIssue: { key: "O-1", fields: { summary: "o" } },
        inwardIssue: { key: "I-1", fields: { summary: "i" } },
      };
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { issuelinks: [both] } }, 5);
      expect(detail.links).toEqual([{ relation: "out", key: "O-1", summary: "o", status: undefined }]);
    });

    it("tolerates a link without a type", () => {
      const detail = issueDetail(
        jira,
        { id: "1", key: "X-1", fields: { issuelinks: [{ outwardIssue: { key: "Y-1" } }] } },
        5,
      );
      expect(detail.links).toEqual([{ relation: undefined, key: "Y-1", summary: undefined, status: undefined }]);
    });

    it("tolerates a link with neither side", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { issuelinks: [{ type: { inward: "in" } }] } }, 5);
      expect(detail.links).toEqual([{ relation: "in", key: undefined, summary: undefined, status: undefined }]);
    });
  });

  describe("comments", () => {
    const withComments = (n: number): Issue => ({
      id: "1",
      key: "X-1",
      fields: {
        comment: {
          comments: Array.from({ length: n }, (_, i) => comment(`c${i + 1}`, `body ${i + 1}`, `u${i + 1}`, `2024-01-0${(i % 9) + 1}T00:00:00.000+0000`)),
        },
      },
    });

    it("reports the total even when fewer are shown", () => {
      const detail = issueDetail(jira, withComments(5), 2);
      expect(detail.comments_total).toBe(5);
      expect(detail.comments).toHaveLength(2);
    });

    it("keeps the newest comments (the tail of the array) in original order", () => {
      const detail = issueDetail(jira, withComments(5), 2);
      expect(detail.comments.map((c) => c.id)).toEqual(["c4", "c5"]);
    });

    it("shows all comments when the limit exceeds the count", () => {
      const detail = issueDetail(jira, withComments(3), 20);
      expect(detail.comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    });

    it("shows all comments when the limit equals the count", () => {
      const detail = issueDetail(jira, withComments(3), 3);
      expect(detail.comments).toHaveLength(3);
    });

    it("shows no comments when the limit is 0 but still reports the total", () => {
      const detail = issueDetail(jira, withComments(3), 0);
      expect(detail.comments).toEqual([]);
      expect(detail.comments_total).toBe(3);
    });

    it("shows exactly one comment (the newest) when the limit is 1", () => {
      const detail = issueDetail(jira, withComments(3), 1);
      expect(detail.comments.map((c) => c.id)).toEqual(["c3"]);
    });

    it("handles an empty comment list", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { comment: { comments: [] } } }, 5);
      expect(detail.comments_total).toBe(0);
      expect(detail.comments).toEqual([]);
    });

    it("handles a comment container without a comments array", () => {
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields: { comment: { total: 0 } } }, 5);
      expect(detail.comments_total).toBe(0);
      expect(detail.comments).toEqual([]);
    });

    it("maps id, author, created and body", () => {
      const detail = issueDetail(jira, withComments(1), 5);
      expect(detail.comments[0]).toEqual({ id: "c1", author: "u1", created: "2024-01-01 00:00", body: "body 1" });
    });

    it("uses null for a missing author and undefined for a missing created", () => {
      const fields = { comment: { comments: [{ id: "c1", body: adfDoc("x") }] } };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).comments[0]).toEqual({
        id: "c1",
        author: null,
        created: undefined,
        body: "x",
      });
    });

    it("converts a rich ADF body to text", () => {
      const body = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Fixed in " }, { type: "text", text: "abc123", marks: [{ type: "code" }] }] },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }] },
        ],
      };
      const fields = { comment: { comments: [{ id: "c1", body }] } };
      expect(issueDetail(jira, { id: "1", key: "X-1", fields }, 5).comments[0].body).toBe("Fixed in `abc123`\n\n- item");
    });

    it("passes a string body through and renders a missing body as empty", () => {
      const fields = { comment: { comments: [{ id: "c1", body: "plain" }, { id: "c2" }] } };
      const detail = issueDetail(jira, { id: "1", key: "X-1", fields }, 5);
      expect(detail.comments[0].body).toBe("plain");
      expect(detail.comments[1].body).toBe("");
    });
  });

  it("does not mutate the input issue", () => {
    const issue = detailIssue();
    const snapshot = JSON.parse(JSON.stringify(issue));
    issueDetail(jira, issue, 2);
    expect(issue).toEqual(snapshot);
  });
});
