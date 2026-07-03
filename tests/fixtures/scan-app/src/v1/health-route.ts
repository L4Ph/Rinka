import { Hono } from "hono";

// Fixture module resolved by scan-dynamic-routes tests.
export const healthRoute = new Hono().get("/", (c) => c.json({ status: "ok" }));
