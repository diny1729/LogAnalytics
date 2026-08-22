import { Router } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { applyFilterSelections, assertSafeKql, parseFilters } from "./kql.js";
import { queryWorkspaceLogs } from "./logAnalytics.js";
import { generateChatResponse } from "./chat.js";

const router = Router();

const parseBodySchema = z.object({
  query: z.string().min(1).max(config.QUERY_MAX_LENGTH)
});

const filterSelectionSchema = z.object({
  id: z.string().min(1).max(128),
  enabled: z.boolean()
});

const queryBodySchema = z.object({
  workspaceId: z.string().min(1).max(256).optional(),
  query: z.string().min(1).max(config.QUERY_MAX_LENGTH),
  timespan: z.string().min(2).max(64).default("PT24H"),
  filters: z.array(filterSelectionSchema).default([]),
  maxRows: z.coerce.number().int().positive().max(50000).default(1000)
});

router.get("/health", (_request, response) => {
  response.json({
    ok: true,
    azureWorkspaceConfigured: Boolean(config.LOG_ANALYTICS_WORKSPACE_ID),
    workspaceOverrideEnabled: config.ALLOW_WORKSPACE_OVERRIDE,
    port: config.PORT,
    timestamp: new Date().toISOString()
  });
});

router.get("/workspaces", (_request, response) => {
  const envWorkspaces = process.env.VITE_WORKSPACES || config.VITE_WORKSPACES || "";
  const list: Array<{ id: string; name: string; customerId: string }> = [];

  if (envWorkspaces.trim()) {
    envWorkspaces.split(",").forEach((entry: string) => {
      const parts = entry.split(":");
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const customerId = parts.slice(1).join(":").trim();
        if (name && customerId) {
          list.push({ id: customerId, name, customerId });
        }
      } else if (entry.trim()) {
        const val = entry.trim();
        list.push({ id: val, name: `Workspace (${val.substring(0, 8)}...)`, customerId: val });
      }
    });
  }

  const defaultWs = process.env.LOG_ANALYTICS_WORKSPACE_ID || config.LOG_ANALYTICS_WORKSPACE_ID;
  if (defaultWs && defaultWs.trim() && !list.some(w => w.customerId === defaultWs.trim())) {
    list.unshift({
      id: defaultWs.trim(),
      name: "Default Workspace",
      customerId: defaultWs.trim()
    });
  }

  response.json({ workspaces: list });
});

router.post("/parse", (request, response, next) => {
  try {
    const body = parseBodySchema.parse(request.body);
    assertSafeKql(body.query, config.QUERY_MAX_LENGTH);

    response.json({
      filters: parseFilters(body.query)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/query", async (request, response, next) => {
  try {
    const body = queryBodySchema.parse(request.body);
    assertSafeKql(body.query, config.QUERY_MAX_LENGTH);

    const authHeader = request.headers.authorization;
    let token: string | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    const workspaceId = resolveWorkspaceId(body.workspaceId, !!token);
    const query = applyFilterSelections(body.query, body.filters);
    assertSafeKql(query, config.QUERY_MAX_LENGTH);

    const result = await queryWorkspaceLogs({
      workspaceId,
      query,
      timespan: body.timespan,
      maxRows: body.maxRows,
      userToken: token
    });

    response.json({
      ...result,
      effectiveQuery: query
    });
  } catch (error) {
    next(error);
  }
});

const chatBodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1)
  })).min(1)
});

router.post("/chat", async (request, response, next) => {
  try {
    const body = chatBodySchema.parse(request.body);
    const answer = await generateChatResponse(body.messages);
    response.json({ answer });
  } catch (error) {
    next(error);
  }
});

const WORKSPACE_GUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function resolveWorkspaceId(requestWorkspaceId?: string, hasUserToken: boolean = false): string {
  if (requestWorkspaceId && !config.ALLOW_WORKSPACE_OVERRIDE && !hasUserToken) {
    throw new Error("Workspace override is disabled.");
  }

  const workspaceId = requestWorkspaceId || config.LOG_ANALYTICS_WORKSPACE_ID;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    throw new Error("LOG_ANALYTICS_WORKSPACE_ID is not configured. Please set a valid Azure Log Analytics Workspace ID in your environment.");
  }

  if (!WORKSPACE_GUID_REGEX.test(workspaceId)) {
    throw new Error(`Invalid Azure Log Analytics Workspace ID format '${workspaceId}'. Expected a valid GUID (e.g. 998edd10-05e8-4067-be07-36cc1f14c0d7).`);
  }

  return workspaceId;
}

export { router };
