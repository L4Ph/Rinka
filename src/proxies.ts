/**
 * Typed WorkerEntrypoint proxy factories for dynamic route bindings.
 *
 * Worker Loader serializes the dynamic Worker's `env`; platform bindings
 * (KV / R2 / Queue / AI) are not structured-clonable, so the host exports a
 * proxy class per binding and hibana passes a derived `ctx.exports` stub
 * (`ctx.exports.Proxy({ props })` — the bare loopback object doesn't survive
 * env serialization) into the loader env instead. Each factory returns a
 * class bound to ONE env binding, checked at compile time: the `binding`
 * argument only accepts keys of `TEnv` whose value has the required binding
 * type, so a typo or a type-mismatched binding fails the host's typecheck,
 * not the first request.
 *
 *   export class RateLimitKvProxy extends kvNamespaceProxy<Env>("RATE_LIMIT_KV") {}
 *
 * The classes must be top-level exports of the Worker entry module (that is
 * what `ctx.exports` exposes). Every value crossing a stub must be
 * RPC-serializable: structured-clonable data, byte-oriented ReadableStream,
 * or Request/Response (32 MiB serialized cap per call; streams are exempt).
 * Each stub interface below is the exact capability a dynamic route receives
 * — deliberately narrower than the native binding type.
 *
 * This module imports `cloudflare:workers` and is workerd-only; import it
 * from Worker code, never from build/node code (use `hibana` / `hibana/vite`
 * there).
 */
import { WorkerEntrypoint } from "cloudflare:workers";

/** Keys of TEnv whose value satisfies TBinding — the compile-time registry check. */
export type BindingOfType<TEnv, TBinding> = {
  [K in keyof TEnv]-?: NonNullable<TEnv[K]> extends TBinding ? K : never;
}[keyof TEnv] &
  string;

/**
 * Factories stay statically safe at the call boundary (`BindingOfType`
 * rejects wrong keys), but the running Worker's env is provided by wrangler
 * config — this guard keeps a config/manifest drift loud instead of a
 * TypeError deep inside the native binding.
 */
function resolveBindingValue<T>(
  env: object,
  binding: string,
  guard: (value: unknown) => value is T,
  owner: string,
  expected: string,
): T {
  const value: unknown = Reflect.get(env, binding);
  if (!guard(value)) {
    throw new Error(`${owner}: host env binding "${binding}" is not ${expected}`);
  }
  return value;
}

function hasMethods<K extends string>(value: unknown, keys: K[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  return keys.every((key) => typeof Reflect.get(value, key) === "function");
}

/** The KV capability a dynamic route receives (subset of KVNamespace, duck-type compatible). */
export interface KvNamespaceStub {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
}

function isKvNamespaceLike(value: unknown): value is KVNamespace {
  return hasMethods(value, ["get", "put"]);
}

export function kvNamespaceProxy<TEnv extends object>(binding: BindingOfType<TEnv, KVNamespace>) {
  return class extends WorkerEntrypoint<TEnv> implements KvNamespaceStub {
    #namespace(): KVNamespace {
      return resolveBindingValue(
        this.env,
        binding,
        isKvNamespaceLike,
        "kvNamespaceProxy",
        "a KV namespace",
      );
    }

    async get(key: string): Promise<string | null> {
      return this.#namespace().get(key);
    }

    async put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void> {
      return this.#namespace().put(key, value, options);
    }
  };
}

/** RPC-safe projection of R2Object — platform classes cannot cross RPC. */
export interface R2ObjectStub {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBodyStub extends R2ObjectStub {
  /** Stream ownership transfers over RPC — read once (e.g. `new Response(body).arrayBuffer()`). */
  body: ReadableStream;
}

/**
 * The R2 capability a dynamic route receives. Diverges from R2Bucket:
 * `get` returns a plain DTO, and `put` takes only known-length values (R2
 * rejects length-unknown streams, and RPC-transferred streams lose their
 * length). Type route bindings with this stub, e.g.
 * `Hono<{ Bindings: Omit<Env, "THUMBNAIL_CACHE"> & { THUMBNAIL_CACHE: R2BucketStub } }>`.
 */
export interface R2BucketStub {
  get(key: string): Promise<R2ObjectBodyStub | null>;
  head(key: string): Promise<R2ObjectStub | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> },
  ): Promise<void>;
  delete(keys: string | string[]): Promise<void>;
}

function isR2BucketLike(value: unknown): value is R2Bucket {
  return hasMethods(value, ["get", "put", "head", "delete"]);
}

function toR2ObjectStub(object: R2Object): R2ObjectStub {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag,
    uploaded: object.uploaded,
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  };
}

export function r2BucketProxy<TEnv extends object>(binding: BindingOfType<TEnv, R2Bucket>) {
  return class extends WorkerEntrypoint<TEnv> implements R2BucketStub {
    #bucket(): R2Bucket {
      return resolveBindingValue(
        this.env,
        binding,
        isR2BucketLike,
        "r2BucketProxy",
        "an R2 bucket",
      );
    }

    async get(key: string): Promise<R2ObjectBodyStub | null> {
      const object = await this.#bucket().get(key);
      if (!object) return null;
      return { ...toR2ObjectStub(object), body: object.body };
    }

    async head(key: string): Promise<R2ObjectStub | null> {
      const object = await this.#bucket().head(key);
      return object ? toR2ObjectStub(object) : null;
    }

    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | string,
      options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> },
    ): Promise<void> {
      await this.#bucket().put(key, value, options);
    }

    async delete(keys: string | string[]): Promise<void> {
      await this.#bucket().delete(keys);
    }
  };
}

/** The Queue capability a dynamic route receives (duck-type compatible with Queue). */
export interface QueueStub<Body = unknown> {
  send(message: Body, options?: QueueSendOptions): Promise<void>;
  sendBatch(messages: MessageSendRequest<Body>[], options?: QueueSendBatchOptions): Promise<void>;
}

function isQueueLike(value: unknown): value is Queue<unknown> {
  return hasMethods(value, ["send", "sendBatch"]);
}

export function queueProxy<TEnv extends object>(binding: BindingOfType<TEnv, Queue<unknown>>) {
  return class extends WorkerEntrypoint<TEnv> implements QueueStub {
    #queue(): Queue<unknown> {
      return resolveBindingValue(this.env, binding, isQueueLike, "queueProxy", "a Queue producer");
    }

    async send(message: unknown, options?: QueueSendOptions): Promise<void> {
      await this.#queue().send(message, options);
    }

    async sendBatch(
      messages: MessageSendRequest<unknown>[],
      options?: QueueSendBatchOptions,
    ): Promise<void> {
      await this.#queue().sendBatch(messages, options);
    }
  };
}

/** RPC-safe projection of D1Database — D1PreparedStatement cannot cross RPC,
 * so prepare/bind/run is collapsed into flat query/raw/first methods. */
export interface D1DatabaseStub {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<D1Result<T>>;
  raw<T = unknown[]>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
  execute(sql: string): Promise<D1ExecResult>;
  batch<T = unknown>(statements: { sql: string; params: unknown[] }[]): Promise<D1Result<T>[]>;
}

function isD1DatabaseLike(value: unknown): value is D1Database {
  return hasMethods(value, ["prepare", "batch", "exec"]);
}

export function d1DatabaseProxy<TEnv extends object>(binding: BindingOfType<TEnv, D1Database>) {
  return class extends WorkerEntrypoint<TEnv> implements D1DatabaseStub {
    #db(): D1Database {
      return resolveBindingValue(
        this.env,
        binding,
        isD1DatabaseLike,
        "d1DatabaseProxy",
        "a D1 database",
      );
    }

    async query<T = Record<string, unknown>>(
      sql: string,
      ...params: unknown[]
    ): Promise<D1Result<T>> {
      let stmt = this.#db().prepare(sql);
      if (params.length > 0) {
        stmt = stmt.bind(...params);
      }
      return stmt.run<T>();
    }

    async raw<T = unknown[]>(sql: string, ...params: unknown[]): Promise<T[]> {
      let stmt = this.#db().prepare(sql);
      if (params.length > 0) {
        stmt = stmt.bind(...params);
      }
      return stmt.raw<T>();
    }

    async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
      let stmt = this.#db().prepare(sql);
      if (params.length > 0) {
        stmt = stmt.bind(...params);
      }
      return stmt.first<T>();
    }

    async execute(sql: string): Promise<D1ExecResult> {
      return this.#db().exec(sql);
    }

    async batch<T = unknown>(
      statements: { sql: string; params: unknown[] }[],
    ): Promise<D1Result<T>[]> {
      const stmts = statements.map(({ sql, params }) => {
        let stmt = this.#db().prepare(sql);
        if (params.length > 0) {
          stmt = stmt.bind(...params);
        }
        return stmt;
      });
      return this.#db().batch<T>(stmts);
    }
  };
}

type AiLike = {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  gateway(gatewayId: string): { getUrl(provider?: string): Promise<string> };
};

/**
 * The Workers AI capability a dynamic route receives. `gatewayUrl` flattens
 * `env.AI.gateway(id).getUrl(provider)` — the gateway object cannot cross RPC.
 */
export interface WorkersAiStub {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  gatewayUrl(gatewayId: string, provider?: string): Promise<string>;
}

function isAiLike(value: unknown): value is AiLike {
  return hasMethods(value, ["run", "gateway"]);
}

export function workersAiProxy<TEnv extends object>(binding: BindingOfType<TEnv, Ai>) {
  return class extends WorkerEntrypoint<TEnv> implements WorkersAiStub {
    #ai(): AiLike {
      return resolveBindingValue(
        this.env,
        binding,
        isAiLike,
        "workersAiProxy",
        "a Workers AI binding",
      );
    }

    async run(
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<unknown> {
      return this.#ai().run(model, inputs, options);
    }

    async gatewayUrl(gatewayId: string, provider?: string): Promise<string> {
      return this.#ai().gateway(gatewayId).getUrl(provider);
    }
  };
}
