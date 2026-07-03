import type { DynamicRouteManifest } from "./loader";

let manifest: DynamicRouteManifest = {};

export function registerDynamicRouteManifest(next: DynamicRouteManifest): void {
  manifest = next;
}

export function getDynamicRouteManifest(): DynamicRouteManifest {
  return manifest;
}
