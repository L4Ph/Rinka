import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    env: Record<string, unknown>;
    ctx: { props: Record<string, unknown> };
    constructor(_ctx: unknown, env: Record<string, unknown>) {
      this.env = env ?? {};
      this.ctx = { props: {} };
    }
  },
}));

const { d1DatabaseProxy } = await import("./proxies");

describe("d1DatabaseProxy", () => {
  function makeD1Like() {
    const run = vi.fn<() => Promise<unknown>>(async () => ({
      success: true,
      meta: {
        duration: 1,
        size_after: 0,
        rows_read: 0,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
      results: [{ id: 1, name: "test" }],
    }));
    const raw = vi.fn<() => Promise<unknown[]>>(async () => [[1, "test"]]);
    const first = vi.fn<() => Promise<unknown>>(async () => ({ id: 1, name: "test" }));
    const exec = vi.fn<() => Promise<unknown>>(async () => ({ count: 1, duration: 1 }));
    const batch = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [
      { success: true, meta: {}, results: [] },
    ]);
    const prepare = vi.fn<
      (sql: string) => {
        bind: (...params: unknown[]) => typeof stmt;
        run: typeof run;
        raw: typeof raw;
        first: typeof first;
      }
    >(() => stmt);
    const stmt = {
      bind: vi.fn((..._params: unknown[]) => stmt),
      run,
      raw,
      first,
    };
    return {
      prepare,
      exec,
      batch,
      stmt,
    };
  }

  it("rejects a host env binding that is not a D1 database", async () => {
    const ProxyClass = d1DatabaseProxy<any>("MY_DB");
    const proxy = new ProxyClass(
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
        tracing: {},
      } as unknown as ExecutionContext,
      {
        MY_DB: { notA: "database" },
      },
    ) as InstanceType<typeof ProxyClass>;

    await expect(proxy.query("SELECT 1")).rejects.toThrow(/MY_DB.*not a D1 database/);
  });

  function makeProxy(env: Record<string, unknown>) {
    const ProxyClass = d1DatabaseProxy<any>("MY_DB");
    return new ProxyClass(
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
        tracing: {},
      } as unknown as ExecutionContext,
      env,
    ) as InstanceType<typeof ProxyClass>;
  }

  it("forwards query() to prepare.bind.run", async () => {
    const mock = makeD1Like();
    const proxy = makeProxy({
      MY_DB: { prepare: mock.prepare, exec: mock.exec, batch: mock.batch },
    });

    const result = await proxy.query("SELECT * FROM items WHERE id = ?", 1);

    expect(mock.prepare).toHaveBeenCalledWith("SELECT * FROM items WHERE id = ?");
    expect(mock.stmt.bind).toHaveBeenCalledWith(1);
    expect(mock.stmt.run).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: true,
      meta: expect.any(Object),
      results: [{ id: 1, name: "test" }],
    });
  });

  it("calls query() without params when none are given", async () => {
    const mock = makeD1Like();
    const proxy = makeProxy({
      MY_DB: { prepare: mock.prepare, exec: mock.exec, batch: mock.batch },
    });

    await proxy.query("SELECT * FROM items");

    expect(mock.prepare).toHaveBeenCalledWith("SELECT * FROM items");
    expect(mock.stmt.bind).not.toHaveBeenCalled();
    expect(mock.stmt.run).toHaveBeenCalledOnce();
  });

  it("forwards raw() to prepare.bind.raw", async () => {
    const mock = makeD1Like();
    const proxy = makeProxy({
      MY_DB: { prepare: mock.prepare, exec: mock.exec, batch: mock.batch },
    });

    const result = await proxy.raw("SELECT id, name FROM items");

    expect(mock.stmt.raw).toHaveBeenCalledOnce();
    expect(result).toEqual([[1, "test"]]);
  });

  it("forwards first() to prepare.bind.first", async () => {
    const mock = makeD1Like();
    const proxy = makeProxy({
      MY_DB: { prepare: mock.prepare, exec: mock.exec, batch: mock.batch },
    });

    const result = await proxy.first("SELECT * FROM items WHERE id = ?", 1);

    expect(mock.stmt.first).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 1, name: "test" });
  });

  it("forwards execute() to db.exec", async () => {
    const mock = makeD1Like();
    const proxy = makeProxy({
      MY_DB: { prepare: mock.prepare, exec: mock.exec, batch: mock.batch },
    });

    const result = await proxy.execute("DROP TABLE IF EXISTS temp");

    expect(mock.exec).toHaveBeenCalledWith("DROP TABLE IF EXISTS temp");
    expect(result).toEqual({ count: 1, duration: 1 });
  });

  it("forwards batch() to db.batch with prepared statements", async () => {
    const stmt2 = { bind: vi.fn(() => stmt2), run: vi.fn(), raw: vi.fn(), first: vi.fn() };
    const mock = makeD1Like();
    const mockWithMultiPrepare = {
      prepare: vi.fn((sql: string) => {
        if (sql === "INSERT INTO t (c) VALUES (?)") return stmt2;
        return mock.prepare(sql);
      }),
      exec: mock.exec,
      batch: mock.batch,
    };
    const proxy = makeProxy({ MY_DB: mockWithMultiPrepare });

    await proxy.batch([
      { sql: "UPDATE items SET name = ? WHERE id = ?", params: ["new", 1] },
      { sql: "INSERT INTO t (c) VALUES (?)", params: ["x"] },
    ]);

    expect(mock.batch).toHaveBeenCalledOnce();
    const batchArg = mock.batch.mock.calls[0]?.[0];
    expect(Array.isArray(batchArg)).toBe(true);
    expect((batchArg as unknown[]).length).toBe(2);
  });
});
