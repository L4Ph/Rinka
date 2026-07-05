import { statSync } from "node:fs";
import { resolve } from "node:path";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

export function resolveModuleFile(
  importPath: string,
  fromDir: string,
  pathAliases: Record<string, string> = {},
): string {
  let absoluteBase = importPath.startsWith(".")
    ? resolve(fromDir, importPath)
    : resolve(fromDir, importPath);

  for (const [alias, target] of Object.entries(pathAliases)) {
    if (!alias.endsWith("*")) continue;
    const prefix = alias.slice(0, -1);
    if (!importPath.startsWith(prefix)) continue;
    const suffix = importPath.slice(prefix.length);
    const targetBase = target.endsWith("*") ? target.slice(0, -1) : target;
    absoluteBase = resolve(targetBase, suffix);
    break;
  }

  const candidates = [
    absoluteBase,
    ...EXTENSIONS.map((ext) => `${absoluteBase}${ext}`),
    ...EXTENSIONS.map((ext) => resolve(absoluteBase, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not found
    }
  }

  throw new Error(
    `Could not resolve module "${importPath}" from ${fromDir}. Tried:\n- ${candidates.join("\n- ")}`,
  );
}

export function defaultPathAliases(root: string): Record<string, string> {
  return {
    "@/*": `${resolve(root, "src")}/*`,
  };
}
