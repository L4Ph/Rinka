import { Hono } from "hono";
import { dynamic } from "rinka";
// Registers the dynamic route manifest and the host-embedded Worker modules.
import "./generated/dynamic-manifest";
import { renderer } from "./renderer";
import { indexRoute } from "./routes";
import { aboutRoute } from "./routes/about";
import { photoRoute } from "./routes/photos";
import { prefectureRoute } from "./routes/prefectures";
import { shopRoute } from "./routes/shops";

const app = new Hono<{ Bindings: CloudflareBindings }>()
  .use(renderer)
  .route("/", dynamic(indexRoute, { id: "index", bindings: [] }))
  .route("/shops", dynamic(shopRoute, { id: "shops", bindings: [] }))
  .route("/shops", dynamic(photoRoute, { id: "photos", bindings: [] }))
  .route("/prefectures", dynamic(prefectureRoute, { id: "prefectures", bindings: [] }))
  .route("/about", aboutRoute);

export default app;
