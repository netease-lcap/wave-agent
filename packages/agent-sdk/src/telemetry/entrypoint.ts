/**
 * Where `app.entrypoint` comes from: the entrypoint a session declared when it
 * was created, stored in the agent's DI container by `setupContainer`, already
 * narrowed to the known table (see `normalizeEntrypoint`).
 *
 * Behind an accessor because several managers read it while making records and
 * the container token is a bare string: one place to keep them from drifting.
 *
 * Kept in its own module — apart from `attributes.ts`, which reaches the auth
 * service and a `git` process — so a caller that only needs the entrypoint does
 * not pull the identity resolution into its import graph.
 */

import type { HostEntrypoint } from "../constants/telemetry.js";
import type { Container } from "../utils/container.js";

export function entrypointOf(container: Container): HostEntrypoint | undefined {
  return container.get<HostEntrypoint>("Entrypoint");
}
