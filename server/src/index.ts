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

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection at Promise:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception thrown:", error);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

app.disable("x-powered-by");
app.use(helmet());
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
app.use(
  rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

app.use("/api", router);

if (config.NODE_ENV === "production" || fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
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
  console.log(`Azure KQL app API listening on http://0.0.0.0:${config.PORT}`);
});
