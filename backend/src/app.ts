import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { authMiddleware } from "./auth.js";
import { aiMode, config } from "./config.js";
import { query } from "./db/pool.js";
import { errorMiddleware, notFoundHandler } from "./lib/http.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { bootstrapRouter } from "./routes/bootstrap.js";
import { collabRouter } from "./routes/collab.js";
import { decisionsRouter } from "./routes/decisions.js";
import { projectsRouter } from "./routes/projects.js";
import { tasksRouter } from "./routes/tasks.js";
import { ticketsRouter } from "./routes/tickets.js";
import { organizationsRouter, workspacesRouter } from "./routes/workspaces.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: [config.webOrigin, "http://localhost:5173", "http://127.0.0.1:5173"],
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-user-id",
        "x-workspace-id",
        "x-request-id",
      ],
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res, next) => {
    try {
      await query("SELECT 1");
      res.json({
        status: "ok",
        time: new Date().toISOString(),
        ai: aiMode.provider,
        aiLabel: aiMode.label,
      });
    } catch (error) {
      next(error);
    }
  });

  // Authentication routes must be reachable before the global auth middleware.
  app.use("/api/auth", authRouter);

  app.use(authMiddleware);

  app.use("/api", bootstrapRouter);
  app.use("/api", tasksRouter);
  app.use("/api", collabRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/tickets", ticketsRouter);
  app.use("/api/decisions", decisionsRouter);
  app.use("/api/organizations", organizationsRouter);
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/ai", aiRouter);

  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
}
