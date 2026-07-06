import { raw } from "hono/html";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";

// A route runs in a Worker isolate when its env lacks the host-only LOADER
// binding (the isolate only receives its declared bindings). Inline/host routes
// see the full host env, so LOADER is present.
const RuntimeBadge = () => {
  const c = useRequestContext();
  const dynamic = !("LOADER" in ((c.env as Record<string, unknown>) ?? {}));
  return (
    <div class={`rt-badge ${dynamic ? "rt-dynamic" : "rt-host"}`}>
      {dynamic ? "⚡ Dynamic Worker" : "🏠 Host"}
    </div>
  );
};

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>rinka example</title>
        <style>
          {raw(`
          :root { color-scheme: light dark; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #1b1b1b;
            background: #fafafa;
          }
          main { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
          h1 { margin: 0 0 .5rem; font-size: 1.8rem; letter-spacing: -0.01em; }
          h2 { margin: 2rem 0 .75rem; font-size: 1.1rem; color: #555; }
          p { margin: .5rem 0; }
          a { color: #b5382b; text-decoration: none; }
          a:hover { text-decoration: underline; }
          ul { padding-left: 1.15rem; }
          li { margin: .35rem 0; }
          img { max-width: 100%; height: auto; border-radius: 10px; }
          footer {
            max-width: 720px;
            margin: 0 auto;
            padding: 1.5rem 1.25rem 3rem;
            border-top: 1px solid #ececec;
            color: #6f6f6f;
            font-size: .85rem;
          }
          footer a { color: inherit; text-decoration: underline; }
          .rt-badge {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 10;
            padding: .3rem .7rem;
            border-radius: 999px;
            font-size: .8rem;
            font-weight: 600;
            color: #fff;
            box-shadow: 0 1px 4px rgba(0,0,0,.2);
          }
          .rt-dynamic { background: #b5382b; }
          .rt-host { background: #555; }
          @media (prefers-color-scheme: dark) {
            body { color: #e9e9e9; background: #151515; }
            h2 { color: #b7b7b7; }
            a { color: #ff7a6e; }
            footer { border-top-color: #2a2a2a; color: #9a9a9a; }
            .rt-dynamic { background: #ff7a6e; color: #1b1b1b; }
            .rt-host { background: #3a3a3a; }
          }
        `)}
        </style>
      </head>
      <body>
        <RuntimeBadge />
        <main>{children}</main>
        <footer>
          🍜 Ramen data from{" "}
          <a href="https://github.com/yusukebe/ramen-api" target="_blank" rel="noopener noreferrer">
            Ramen API
          </a>{" "}
          by Yusuke Wada — thanks!
        </footer>
      </body>
    </html>
  );
});
