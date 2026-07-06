import { Hono } from "hono";
import { registerDispatch } from "./generated/dispatch";

// Thin gateway: apply edge middleware here (app.use(...)), then let rinka wire
// every route — inline routes are mounted, dynamic routes delegate to their
// Worker isolate. The RPC type lives in ./generated/app-type, decoupled from
// this runtime entry.
const app = new Hono<{ Bindings: CloudflareBindings }>();
registerDispatch(app);

export default app;

export type { AppType } from "./generated/app-type";
