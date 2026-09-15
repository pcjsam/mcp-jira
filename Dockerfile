# syntax=docker/dockerfile:1
#
# Production-only image. TypeScript is compiled on the host first:
#
#   npm run build && docker build -t mcp-jira .
#
# Only package.json, the lockfile and the compiled build/ directory go in;
# devDependencies (typescript, @types/node) are never installed here.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY build ./build
USER node

# Credentials are supplied at run time, never baked into the image:
#   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
# The server speaks MCP over stdio, so run with `docker run -i` (no -t).
ENTRYPOINT ["node", "build/index.js"]
