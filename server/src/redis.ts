import { Redis } from "ioredis";
import crypto from "node:crypto";
import { config } from "./config.js";
import type { QueryResponse } from "./types.js";

let redisClient: Redis | null = null;
let isConnected = false;

function initRedis(): Redis | null {
  if (!config.REDIS_ENABLED) {
    console.log("ℹ️ [Redis Cache] Disabled via configuration.");
    return null;
  }

  const host = config.REDIS_HOST || (config.NODE_ENV === "production" ? "redis-logapp-svc" : "localhost");
  const port = config.REDIS_PORT || 6379;

  try {
    const client = config.REDIS_URL
      ? new Redis(config.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          retryStrategy(times: number) {
            if (times > 3) {
              return null; // Stop retrying after 3 attempts on startup
            }
            return Math.min(times * 500, 2000);
          }
        })
      : new Redis({
          host,
          port,
          password: config.REDIS_PASSWORD || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          retryStrategy(times: number) {
            if (times > 3) {
              return null; // Stop retrying after 3 attempts on startup
            }
            return Math.min(times * 500, 2000);
          }
        });

    client.on("connect", () => {
      isConnected = true;
      console.log(`✅ [Redis Cache] Connected successfully to ${host}:${port}`);
    });

    client.on("ready", () => {
      isConnected = true;
    });

    client.on("close", () => {
      isConnected = false;
    });

    client.on("error", (err: Error) => {
      isConnected = false;
      // Log connection error without crashing
      if (config.NODE_ENV !== "test") {
        console.warn(`⚠️ [Redis Cache] Warning: ${err.message}`);
      }
    });

    // Initiate non-blocking connection
    client.connect().catch((err: Error) => {
      isConnected = false;
      if (config.NODE_ENV !== "test") {
        console.warn(`⚠️ [Redis Cache] Could not connect to Redis at ${host}:${port}. Operating in cache-bypass mode: ${err.message}`);
      }
    });

    return client;
  } catch (err) {
    console.warn("⚠️ [Redis Cache] Initialization error:", err);
    return null;
  }
}

redisClient = initRedis();

export function extractUserIdentifier(userToken?: string): string {
  if (!userToken) {
    return "service_principal";
  }

  try {
    const parts = userToken.split(".");
    if (parts.length === 3) {
      const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const decodedJson = Buffer.from(payloadBase64, "base64").toString("utf8");
      const claims = JSON.parse(decodedJson);
      
      const userId = claims.oid || claims.sub || claims.upn || claims.preferred_username || claims.unique_name || claims.email;
      if (userId) {
        // Sanitize userId to be safe for Redis key prefix
        return `user_${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      }
    }
  } catch {
    // If decoding fails, fall back to hashing the token
  }

  const tokenHash = crypto.createHash("sha256").update(userToken).digest("hex").slice(0, 16);
  return `token_${tokenHash}`;
}

export function generateQueryCacheKey(params: {
  workspaceId: string;
  query: string;
  timespan: string;
  maxRows: number;
  userToken?: string;
}): string {
  const userIdentifier = extractUserIdentifier(params.userToken);
  // Normalize query whitespace
  const normalizedQuery = params.query.trim().replace(/\r\n/g, "\n");
  const queryHash = crypto
    .createHash("sha256")
    .update(`${params.workspaceId}|${params.timespan}|${params.maxRows}|${normalizedQuery}`)
    .digest("hex");

  return `loganalytics:query:${userIdentifier}:${queryHash}`;
}

export async function getCachedQueryResult(cacheKey: string): Promise<QueryResponse | null> {
  if (!redisClient || !isConnected) {
    return null;
  }

  try {
    const raw = await redisClient.get(cacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as QueryResponse;
    return {
      ...parsed,
      cached: true
    };
  } catch (err) {
    console.warn("⚠️ [Redis Cache] Error reading cache key:", err);
    return null;
  }
}

export async function setCachedQueryResult(
  cacheKey: string,
  data: QueryResponse,
  ttlSeconds: number = config.REDIS_CACHE_TTL_SECONDS
): Promise<void> {
  if (!redisClient || !isConnected) {
    return;
  }

  try {
    // Avoid caching partial failure errors or empty responses if desirable
    const payload = JSON.stringify({
      tables: data.tables,
      partialError: data.partialError,
      statistics: data.statistics
    });

    await redisClient.setex(cacheKey, ttlSeconds, payload);
  } catch (err) {
    console.warn("⚠️ [Redis Cache] Error saving cache key:", err);
  }
}

export async function clearUserCache(userToken?: string): Promise<{ clearedCount: number; user: string }> {
  if (!redisClient || !isConnected) {
    return { clearedCount: 0, user: "none" };
  }

  const userIdentifier = extractUserIdentifier(userToken);
  try {
    const pattern = `loganalytics:query:${userIdentifier}:*`;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
      return { clearedCount: keys.length, user: userIdentifier };
    }
    return { clearedCount: 0, user: userIdentifier };
  } catch (err) {
    console.warn("⚠️ [Redis Cache] Error clearing user cache:", err);
    return { clearedCount: 0, user: userIdentifier };
  }
}

export function getRedisStatus(): {
  enabled: boolean;
  connected: boolean;
  host: string;
  port: number;
  ttlSeconds: number;
} {
  return {
    enabled: Boolean(config.REDIS_ENABLED),
    connected: isConnected,
    host: config.REDIS_HOST || (config.NODE_ENV === "production" ? "redis-logapp-svc" : "localhost"),
    port: config.REDIS_PORT || 6379,
    ttlSeconds: config.REDIS_CACHE_TTL_SECONDS
  };
}
