// Shared Bun test setup across all workspaces.
process.env.NO_COLOR ??= "1";

import solidPlugin from "@opentui/solid/bun-plugin";

Bun.plugin(solidPlugin);

Error.stackTraceLimit = 50;
