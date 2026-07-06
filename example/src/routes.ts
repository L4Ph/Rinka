import { defineRoutes } from "rinka";
import { indexRoute } from "./routes/index";
import { aboutRoute } from "./routes/about";
import { photoRoute } from "./routes/photos";
import { prefectureRoute } from "./routes/prefectures";
import { shopRoute } from "./routes/shops";

// Single source of truth: rinka scans this to generate AppType and the
// dispatch wiring. `dynamic: true` runs a route in its own Worker isolate;
// the rest run inline in the host gateway.
export default defineRoutes([
  { mount: "/", route: indexRoute, id: "index", dynamic: true, bindings: [] },
  { mount: "/shops", route: shopRoute },
  { mount: "/shops", route: photoRoute, id: "photos", dynamic: true, bindings: [] },
  { mount: "/prefectures", route: prefectureRoute, id: "prefectures", dynamic: true, bindings: [] },
  { mount: "/about", route: aboutRoute },
]);
