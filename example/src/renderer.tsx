import { raw } from "hono/html";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { getDynamicRouteId } from "rinka";

// rinka injects the route id into a dynamic Worker's isolate env, so this is an
// explicit signal (not a heuristic): present -> running in that route's isolate,
// absent -> running inline in the host.
const RuntimeBadge = () => {
  const c = useRequestContext();
  const routeId = getDynamicRouteId(c.env as Record<string, unknown>);
  return (
    <div class={`rt-badge ${routeId ? "rt-dynamic" : "rt-host"}`}>
      {routeId ? `⚡ Dynamic Worker: ${routeId}` : "🏠 Host"}
    </div>
  );
};

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>rinka · Pokédex</title>
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
          main { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
          .site-nav {
            display: flex; align-items: center; justify-content: space-between;
            max-width: 1080px; margin: 0 auto; padding: 1rem 1.25rem;
            border-bottom: 1px solid #ececec;
          }
          .site-nav .brand { font-weight: 700; font-size: 1.05rem; }
          .site-nav nav { display: flex; gap: 1rem; }
          .site-nav nav a { color: #6f6f6f; }
          .site-nav nav a:hover { color: #b5382b; }
          h1 { margin: 0 0 .5rem; font-size: 1.8rem; letter-spacing: -0.01em; }
          h2 { margin: 2rem 0 .75rem; font-size: 1.1rem; color: #555; }
          p { margin: .5rem 0; }
          a { color: #b5382b; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .muted { color: #6f6f6f; font-size: .9rem; }
          code { background: rgba(127,127,127,.15); padding: .05rem .3rem; border-radius: 4px; }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 1rem;
            margin-top: 1.25rem;
          }
          .card { margin: 0; background: #fff; border: 1px solid #ececec; border-radius: 12px; overflow: hidden; }
          .card-link { display: block; background: #f4f4f4; }
          .card img { display: block; width: 100%; height: 180px; object-fit: contain; }
          .card figcaption { display: flex; align-items: center; gap: .4rem; padding: .5rem .65rem; }
          .dexno { font-variant-numeric: tabular-nums; font-size: .72rem; color: #999; font-weight: 600; }
          .pname { text-transform: capitalize; font-weight: 600; margin-right: auto; }
          .like {
            display: inline-flex; gap: .3rem; align-items: center;
            border: 1px solid #e2b4ae; color: #b5382b; background: #fff;
            border-radius: 999px; padding: .2rem .7rem; font: inherit; cursor: pointer;
          }
          .like:hover { background: #fdecea; }
          .like-lg { font-size: 1rem; padding: .45rem 1.1rem; margin: .75rem 0; }

          .pager { display: flex; justify-content: space-between; margin-top: 2rem; }
          .detail { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: flex-start; margin-top: 1rem; }
          .detail-image { width: 320px; max-width: 100%; height: auto; background: #f4f4f4; border-radius: 16px; }
          .detail-body { flex: 1; min-width: 220px; }
          .types { list-style: none; display: flex; gap: .4rem; padding: 0; margin: .75rem 0; }
          .types li { color: #fff; border-radius: 999px; padding: .15rem .8rem; font-size: .85rem; font-weight: 600; }
          .flavor { margin: 1.25rem 0; }
          .stats { list-style: none; padding: 0; max-width: 460px; }
          .stats li { display: grid; grid-template-columns: 3rem 1fr 2.5rem; gap: .5rem; align-items: center; margin: .35rem 0; }
          .stat-label { color: #777; font-size: .85rem; }
          .stat-bar { background: #eee; border-radius: 999px; height: 8px; overflow: hidden; }
          .stat-fill { display: block; height: 100%; background: #b5382b; border-radius: 999px; }
          .stat-value { text-align: right; font-variant-numeric: tabular-nums; font-size: .85rem; }
          .facts { padding-left: 1.15rem; }

          .rt-badge {
            position: fixed; top: 12px; right: 12px; z-index: 10;
            padding: .3rem .7rem; border-radius: 999px;
            font-size: .8rem; font-weight: 600; color: #fff;
            box-shadow: 0 1px 4px rgba(0,0,0,.2);
          }
          .rt-dynamic { background: #b5382b; }
          .rt-host { background: #555; }
          @media (prefers-color-scheme: dark) {
            body { color: #e9e9e9; background: #151515; }
            h2 { color: #b7b7b7; }
            a { color: #ff7a6e; }
            .card { background: #1e1e1e; border-color: #2a2a2a; }
            .card-link, .detail-image { background: #232323; }
            .like { background: #1e1e1e; border-color: #5a3a36; color: #ff7a6e; }
            .like:hover { background: #331f1d; }
            .stat-bar { background: #2a2a2a; }
            .stat-fill { background: #ff7a6e; }
            .site-nav { border-bottom-color: #2a2a2a; }
            .site-nav nav a { color: #9a9a9a; }
            .site-nav nav a:hover { color: #ff7a6e; }
            .rt-dynamic { background: #ff7a6e; color: #1b1b1b; }
            .rt-host { background: #3a3a3a; }
          }
        `)}
        </style>
      </head>
      <body>
        <RuntimeBadge />
        <header class="site-nav">
          <a class="brand" href="/">
            Pokédex
          </a>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
});
