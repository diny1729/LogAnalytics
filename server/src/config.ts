import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: true });
dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_ANALYTICS_WORKSPACE_ID: z.string().optional(),
  ALLOW_WORKSPACE_OVERRIDE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  QUERY_MAX_ROWS: z.coerce.number().int().positive().max(50000).default(5000),
  QUERY_MAX_LENGTH: z.coerce.number().int().positive().max(100000).default(20000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
};
