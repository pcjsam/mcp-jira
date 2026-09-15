import { adfToText } from "./adf.js";
import type { Issue, JiraClient } from "./jira.js";

/** Fields fetched for list views. Small on purpose: every field is tokens Claude reads per row. */
export const LIST_FIELDS = [
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
];

/** Fields fetched for a single-ticket view. */
export const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  "description",
  "comment",
  "subtasks",
  "issuelinks",
  "components",
  "fixVersions",
  "resolution",
  "resolutiondate",
];

export interface IssueRow {
  key: string;
  summary: string;
  status: string | null;
  type: string | null;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  parent?: string;
  due?: string;
  created: string | null;
  updated: string | null;
  url: string;
}

export function issueRow(jira: JiraClient, issue: Issue): IssueRow {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: f.summary ?? "",
    status: f.status?.name ?? null,
    type: f.issuetype?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    ...(f.parent?.key ? { parent: f.parent.key } : {}),
    ...(f.duedate ? { due: f.duedate } : {}),
    created: f.created ? f.created.slice(0, 10) : null,
    updated: f.updated ? f.updated.slice(0, 16).replace("T", " ") : null,
    url: jira.browseUrl(issue.key),
  };
}

export function issueDetail(jira: JiraClient, issue: Issue, commentLimit: number) {
  const f = issue.fields ?? {};
  const comments: any[] = f.comment?.comments ?? [];
  const shown = commentLimit > 0 ? comments.slice(-commentLimit) : [];
  return {
    ...issueRow(jira, issue),
    assignee_account_id: f.assignee?.accountId ?? null,
    resolution: f.resolution?.name ?? null,
    components: (f.components ?? []).map((c: any) => c.name),
    fix_versions: (f.fixVersions ?? []).map((v: any) => v.name),
    description: adfToText(f.description),
    subtasks: (f.subtasks ?? []).map((s: any) => ({
      key: s.key,
      summary: s.fields?.summary,
      status: s.fields?.status?.name,
    })),
    links: (f.issuelinks ?? []).map((l: any) => {
      const other = l.outwardIssue ?? l.inwardIssue;
      const rel = l.outwardIssue ? l.type?.outward : l.type?.inward;
      return { relation: rel, key: other?.key, summary: other?.fields?.summary, status: other?.fields?.status?.name };
    }),
    comments_total: comments.length,
    comments: shown.map((c) => ({
      id: c.id,
      author: c.author?.displayName ?? null,
      created: c.created?.slice(0, 16).replace("T", " "),
      body: adfToText(c.body),
    })),
  };
}
