import { Hono } from "hono";
import { dynamic } from "rinka";
import { aboutRoute } from "./routes/about";
import { indexRoute } from "./routes/index";
import { photoRoute } from "./routes/photos";
import { prefectureRoute } from "./routes/prefectures";
import { shopRoute } from "./routes/shops";

// Thin gateway: apply edge middleware here (app.use(...)), then mount each
// route. Wrap a route with `dynamic()` to run it in its own Worker isolate;
// leave it bare to run inline in the host. `AppType` is just the chained app's
// type, so Hono RPC inference works without any codegen.
const app = new Hono<{ Bindings: CloudflareBindings }>()
  .route("/", dynamic(indexRoute, { id: "index", bindings: [] }))
  .route("/shops", shopRoute)
  .route("/shops", dynamic(photoRoute, { id: "photos", bindings: [] }))
  .route("/prefectures", dynamic(prefectureRoute, { id: "prefectures", bindings: [] }))
  .route("/about", aboutRoute);

export default app;

export type AppType = typeof app;
