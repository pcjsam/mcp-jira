# syntax=docker/dockerfile:1
#
# Multi-stage build. The builder stage installs every dependency (including
# TypeScript) and compiles src/ to build/. The runtime stage starts from a clean
# base, installs only production dependencies, and copies the compiled output
# out of the builder. devDependencies never reach the final image, and the host
# needs nothing but Docker:
#
#   docker build -t mcp-jira .

# ---- builder ---------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && find node_modules -type d -empty -delete
COPY --from=builder /app/build ./build
USER node

# Credentials are supplied at run time, never baked into the image:
#   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
# The server speaks MCP over stdio, so run with `docker run -i` (no -t).
ENTRYPOINT ["node", "build/index.js"]
