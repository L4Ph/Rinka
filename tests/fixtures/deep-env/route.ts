import { Hono } from "hono";
import { auth } from "./auth-mw";

// The route itself touches no env, but the middleware it applies does.
export const route = new Hono().use(auth).get("/", (c) => c.text("ok"));
