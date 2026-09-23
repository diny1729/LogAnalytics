import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config } from "./config.js";
import { router } from "./routes.js";

const app = express();
app.set("trust proxy", 1);

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection at Promise:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception thrown:", error);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: [
          "'self'",
          "https://login.microsoftonline.com",
          "https://graph.microsoft.com",
          "https://management.azure.com",
          "https://api.loganalytics.io",
          "https://*.openai.azure.com"
        ]
      }
    }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        config.corsOrigins.includes("*") ||
        config.corsOrigins.includes(origin) ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("http://192.168.") ||
        config.NODE_ENV !== "production"
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin '${origin}' is not allowed.`));
    }
  })
);
app.use(express.json({ limit: "128kb" }));

// HTTP Request Logger Middleware for Container / Pod Diagnostics
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const url = req.originalUrl || req.url;
  const isApiOrConfig = url.startsWith("/api") || url.startsWith("/runtime-config") || url === "/";

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const symbol = status < 400 ? "🟢" : status < 500 ? "🟡" : "🔴";
    if (isApiOrConfig || status >= 400) {
      console.log(`${symbol} [HTTP] ${req.method} ${url} - Status: ${status} (${duration}ms)`);
    }
  });

  next();
});

// Rate limiting applies ONLY to backend API endpoints to prevent blocking static assets (JS, CSS, fonts, runtime-config)
const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many API requests from this client IP. Please wait a moment and try again."
  }
});

function getRuntimeConfig() {
  return {
    VITE_REQUIRE_AZURE_AD_AUTH: process.env.VITE_REQUIRE_AZURE_AD_AUTH ?? config.VITE_REQUIRE_AZURE_AD_AUTH,
    VITE_AZURE_CLIENT_ID: process.env.VITE_AZURE_CLIENT_ID ?? config.VITE_AZURE_CLIENT_ID,
    VITE_AZURE_TENANT_ID: process.env.VITE_AZURE_TENANT_ID ?? config.VITE_AZURE_TENANT_ID,
    VITE_AZURE_REDIRECT_URI: process.env.VITE_AZURE_REDIRECT_URI ?? config.VITE_AZURE_REDIRECT_URI,
    VITE_AZURE_LOGIN_URI: process.env.VITE_AZURE_LOGIN_URI ?? config.VITE_AZURE_LOGIN_URI,
    VITE_WORKSPACES: process.env.VITE_WORKSPACES ?? config.VITE_WORKSPACES,
    VITE_LOG_ANALYTICS_WORKSPACE_ID: (process.env.LOG_ANALYTICS_WORKSPACE_ID ?? config.LOG_ANALYTICS_WORKSPACE_ID) || "",
    VITE_ALLOWED_AZURE_AD_GROUPS: process.env.VITE_ALLOWED_AZURE_AD_GROUPS ?? config.VITE_ALLOWED_AZURE_AD_GROUPS
  };
}

app.get("/runtime-config.js", (_request, response) => {
  response.setHeader("Content-Type", "application/javascript; charset=UTF-8");
  response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  response.send(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(getRuntimeConfig())};`);
});

app.use("/api", apiLimiter, router);

if (config.NODE_ENV === "production" || fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist, { index: false }));
  app.get("*", (_request, response) => {
    const indexPath = path.join(clientDist, "index.html");
    if (!fs.existsSync(indexPath)) {
      response.status(404).send("Application index.html not found.");
      return;
    }
    let html = fs.readFileSync(indexPath, "utf-8");
    const runtimeConfig = getRuntimeConfig();
    const scriptTag = `<script src="/runtime-config.js"></script>\n<script>window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};</script>`;
    html = html.replace("</head>", `${scriptTag}\n</head>`);
    response.setHeader("Content-Type", "text/html");
    response.send(html);
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const status = error instanceof ZodError ? 400 : 500;
  const message =
    error instanceof ZodError
      ? `Request validation failed: ${error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`
      : error instanceof Error
        ? error.message
        : "Unexpected server error.";

  if (config.NODE_ENV !== "test") {
    console.error("❌ Express API Error:", error);
  }

  response.status(status).json({
    error: message
  });
});

app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`=================================================================`);
  console.log(`🚀 Azure Log Analytics Explorer Server Started`);
  console.log(`   - Port                  : ${config.PORT}`);
  console.log(`   - Environment           : ${config.NODE_ENV}`);
  console.log(`   - Fallback Workspace ID : ${config.LOG_ANALYTICS_WORKSPACE_ID || "(None configured)"}`);
  console.log(`   - AD Auth Required      : ${config.VITE_REQUIRE_AZURE_AD_AUTH}`);
  console.log(`   - Authorized AD Groups  : ${config.VITE_ALLOWED_AZURE_AD_GROUPS || "(All authenticated AD users allowed)"}`);
  console.log(`   - Redis Cache Service   : ${config.REDIS_HOST || "redis-logapp-svc"}:${config.REDIS_PORT || 6379} (Enabled: ${config.REDIS_ENABLED})`);
  console.log(`=================================================================`);
});
