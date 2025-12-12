// Shared Bun test setup across all workspaces.
process.env.NO_COLOR ??= "1";
process.env.MU_TESTING ??= "1";

Error.stackTraceLimit = 50;

