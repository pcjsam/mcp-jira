# mcp-jira-user

A small Jira Cloud MCP server tailored to how Reach Collective works: boards first, then the
tickets on them. Ten tools, plain-text in and out (Jira's ADF is converted at the edge), and
every read tool marked read-only so Claude can auto-approve it.

| Tool             | Does                                                                                                                                                                           | Side effects |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `list_boards`    | boards with id, type and anchored project; filter by name / project / type                                                                                                     | read-only    |
| `get_board`      | one board: columns → statuses, project key, active/future sprints                                                                                                              | read-only    |
| `search_tickets` | issues on one board (`board_id`) or site-wide; filters for assignee (`me`, email, name, `unassigned`), status / category, text, type, `updated_since`, plus raw JQL; paginated | read-only    |
| `get_ticket`     | full issue: description as text, subtasks, links, newest comments                                                                                                              | read-only    |
| `find_users`     | name / email → accountId, for the rare ambiguous name                                                                                                                          | read-only    |
| `create_ticket`  | new issue in a board's project (or an explicit `project_key`)                                                                                                                  | write        |
| `update_ticket`  | summary, description, assignee, priority, labels (replace or add/remove), parent, due date                                                                                     | write        |
| `move_ticket`    | transition by column / status / transition name; lists what is available when nothing matches                                                                                  | write        |
| `add_comment`    | comment on an issue                                                                                                                                                            | write        |
| `delete_ticket`  | permanent delete, optional sub-tasks                                                                                                                                           | destructive  |

`search_tickets` answers the "assigned to X per board" question with `board_id` + `assignee`, and
the cross-board version by dropping `board_id`. Both go through the same tool so Claude only has
to learn one.

## Setup

```bash
npm install
npm run build          # → build/index.js
```

Credentials come from the environment. Create an API token at
https://id.atlassian.com/manage-profile/security/api-tokens and set:

```
JIRA_BASE_URL=https://<site>.atlassian.net
JIRA_EMAIL=<atlassian account email>
JIRA_API_TOKEN=<token>
```

Register it with Claude Code (user scope so the token stays out of the repo):

```bash
claude mcp add --scope user jira \
  -e JIRA_BASE_URL=https://<site>.atlassian.net \
  -e JIRA_EMAIL=you@example.com \
  -e JIRA_API_TOKEN=... \
  -- node /Users/sam/www/sam/mcp-jira-user/build/index.js
```

Or, in an `.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/sam/www/sam/mcp-jira-user/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://<site>.atlassian.net",
        "JIRA_EMAIL": "${JIRA_EMAIL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
      }
    }
  }
}
```

`npm run inspect` opens the MCP Inspector against the built server for manual poking.

## Docker

The Dockerfile is multi-stage. A builder stage installs all dependencies and compiles the
TypeScript; the runtime stage starts from a clean base, installs only production
dependencies and copies the compiled `build/` out of the builder. devDependencies and the
sources never enter the final image, and the host needs nothing but Docker. The server
speaks MCP over stdio, so the container is not a long-running service: the MCP client starts
it per session with `docker run -i` and it exits when stdin closes. Do not add `-t`; a TTY
corrupts the JSON-RPC stream.

```bash
docker build -t mcp-jira-user .
```

Credentials are passed at run time and never baked into the image. The bare `-e NAME` form
forwards the variable from your shell without putting the token on the command line:

```bash
docker run -i --rm -e JIRA_BASE_URL -e JIRA_EMAIL -e JIRA_API_TOKEN mcp-jira-user
```

Register the container with Claude Code:

```bash
claude mcp add --scope user jira \
  -e JIRA_BASE_URL=https://<site>.atlassian.net \
  -e JIRA_EMAIL=you@example.com \
  -e JIRA_API_TOKEN=... \
  -- docker run -i --rm -e JIRA_BASE_URL -e JIRA_EMAIL -e JIRA_API_TOKEN mcp-jira-user
```

Or in an `.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "JIRA_BASE_URL",
        "-e",
        "JIRA_EMAIL",
        "-e",
        "JIRA_API_TOKEN",
        "mcp-jira-user"
      ],
      "env": {
        "JIRA_BASE_URL": "https://<site>.atlassian.net",
        "JIRA_EMAIL": "${JIRA_EMAIL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
      }
    }
  }
}
```

### Publishing to Docker Hub

Docker Hub images are named `<dockerhub-user>/<repo>:<tag>`, so the local `mcp-jira-user` tag
has to be re-tagged before it can be pushed. Use the version from `package.json` as the tag
and also move `latest`:

```bash
docker login                                   # once per machine; prompts for Docker Hub credentials
VERSION=$(node -p "require('./package.json').version")
docker tag mcp-jira-user <dockerhub-user>/mcp-jira-user:$VERSION
docker tag mcp-jira-user <dockerhub-user>/mcp-jira-user:latest
docker push <dockerhub-user>/mcp-jira-user:$VERSION
docker push <dockerhub-user>/mcp-jira-user:latest
```

`docker build` produces an image for the host's CPU architecture only. An image built on
Apple Silicon is arm64 and will not run on an x86 machine. To publish one tag that works on
both, build and push with buildx in a single step instead of the tag/push sequence above:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <dockerhub-user>/mcp-jira-user:$VERSION -t <dockerhub-user>/mcp-jira-user:latest --push .
```

Once pushed, clients reference the Hub name instead of the local tag. `docker run` pulls the
image automatically on first use, so nothing else changes:

```bash
docker run -i --rm -e JIRA_BASE_URL -e JIRA_EMAIL -e JIRA_API_TOKEN <dockerhub-user>/mcp-jira-user
```

Bump `version` in `package.json` before each release so every push gets a distinct tag and
`latest` can be rolled back by re-tagging an older version.

## Text formatting

Descriptions and comments are written as plain text with light markdown, converted to ADF:
blank lines separate paragraphs, `- ` / `1. ` start lists, `# ` headings, ``fences become code
blocks,` `code` `` spans and bare URLs are marked up. Reading goes the other way, including
mentions, tables and nested lists.

## Layout

```
src/
├── index.ts    env check, McpServer, stdio transport
├── tools.ts    the ten tools: schemas, descriptions, annotations, handlers
├── jira.ts     REST v3 + Agile 1.0 client, basic auth, error flattening, user resolution
├── format.ts   compact issue rows / detail view (field allow-lists)
└── adf.ts      text ⇄ Atlassian Document Format
test/
├── adf.test.ts     parser + renderer, every node type, round trips
└── format.test.ts  row / detail flattening, defaults, comment windowing
```

## Tests

Unit tests cover the two pure modules, `adf.ts` and `format.ts`. The client and tool
handlers are thin glue over the network and are not unit-tested.

```
npm test               # run the suite
npm run test:coverage  # with coverage (thresholds enforced in jest.config.js)
npm run typecheck:test # type-check the tests (Jest strips types, it does not check them)
```

Jest runs the TypeScript sources directly through `@swc/jest`. Imports name `.js` files
(nodenext convention); `moduleNameMapper` in `jest.config.js` strips the suffix so Jest
resolves the `.ts` source. The `--experimental-vm-modules` flag in the scripts is what lets
Jest load native ESM.

## Jira API notes

- Boards, board columns and board-scoped issues use the Agile API (`/rest/agile/1.0/board…`).
  A board-scoped search is `GET /board/{id}/issue?jql=` and is offset-paginated.
- Site-wide search uses `POST /rest/api/3/search/jql` (token-paginated; the old `/search` was
  removed by Atlassian in 2025).
- "Move within a board" means a workflow transition. Jira only offers the transitions valid
  from the current status, so `move_ticket` reads them first and reports them on a miss.
  Re-ordering cards (rank) is a separate Agile endpoint and is not exposed yet.
- Assignee resolution: `me` → `/myself`, raw accountIds pass through, anything else goes to
  `/user/search` and must resolve to exactly one active user (exact email or name breaks ties).
