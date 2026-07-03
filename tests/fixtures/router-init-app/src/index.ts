import { Hono } from "hono";

// Minimal fixture app for generate-router-init tests: the generator SSR-loads
// this entry and serializes PreparedRegExpRouter init params from app.routes.
export const app = new Hono()
  .get("/v1/health", (c) => c.json({ status: "ok" }))
  .get("/v1/items/:id", (c) => c.json({ id: c.req.param("id") }));
