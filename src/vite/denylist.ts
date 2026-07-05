import {
  type BindingPolicyMap,
  defaultBindingPolicies,
  resolveBindingPolicies,
} from "../binding-policy";
import {
  isUpgradeHeaderWebSocketCheck,
  isWebSocketPairConstruction,
  parseModuleSource,
  walkModule,
} from "./ast";

export type DynamicRouteDenyReason =
  | { kind: "unregistered-binding"; binding: string }
  | { kind: "forbidden-binding"; binding: string; reason: string }
  | { kind: "wasm" }
  | { kind: "websocket" }
  | { kind: "durable-object-raw-forward" };

export function findDynamicRouteViolations(
  source: string,
  bindings: string[],
  policies: BindingPolicyMap = defaultBindingPolicies,
  filename = "module.ts",
): DynamicRouteDenyReason[] {
  const violations: DynamicRouteDenyReason[] = [
    ...resolveBindingPolicies(bindings, policies).violations,
  ];

  const program = parseModuleSource(source, filename);
  let wasm = false;
  let websocket = false;

  walkModule(program, {
    ImportDeclaration(node) {
      if (/\.wasm(\?[^"']*)?$/.test(node.source.value)) {
        wasm = true;
      }
    },
    BinaryExpression(node) {
      if (isUpgradeHeaderWebSocketCheck(node)) {
        websocket = true;
      }
    },
    NewExpression(node) {
      if (isWebSocketPairConstruction(node)) {
        websocket = true;
      }
    },
  });

  if (wasm) violations.push({ kind: "wasm" });
  if (websocket) violations.push({ kind: "websocket" });

  if (/\.fetch\s*\(\s*c\.req\.raw\s*\)/.test(source)) {
    violations.push({ kind: "durable-object-raw-forward" });
  }

  return violations;
}

export function assertDynamicRouteAllowed(
  source: string,
  bindings: string[],
  policies: BindingPolicyMap = defaultBindingPolicies,
  filename = "module.ts",
): void {
  const violations = findDynamicRouteViolations(source, bindings, policies, filename);
  if (violations.length === 0) return;

  const messages = violations.map((v) => {
    switch (v.kind) {
      case "unregistered-binding":
        return (
          `binding ${v.binding} has no rinka binding policy — Worker Loader env only accepts ` +
          `structured-clonable values and Service Binding stubs, so classify it via the plugin's bindingPolicies option`
        );
      case "forbidden-binding":
        return `binding ${v.binding} is not allowed in dynamic routes: ${v.reason}`;
      case "wasm":
        return "WASM imports are not allowed in dynamic routes";
      case "websocket":
        return "WebSocket upgrade handlers are not allowed in dynamic routes";
      case "durable-object-raw-forward":
        return "Durable Object raw request forwarding is not allowed in dynamic routes";
    }
  });
  throw new Error(`Dynamic route is not allowed:\n- ${messages.join("\n- ")}`);
}
