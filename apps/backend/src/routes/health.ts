import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "figma-jira-backend",
    uptimeSeconds: Math.round(process.uptime()),
  });
});
