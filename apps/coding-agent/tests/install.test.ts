import { describe, expect, it } from "bun:test";
import { parseInstallSource } from "../src/adapters/cli/install";

describe("extension installer", () => {
  it("parses npm sources", () => {
    expect(parseInstallSource("npm:pi-web-access")).toEqual({
      type: "npm",
      spec: "pi-web-access",
    });

    expect(parseInstallSource("pi-web-access")).toEqual({
      type: "npm",
      spec: "pi-web-access",
    });
  });

  it("parses github sources", () => {
    expect(parseInstallSource("github:owner/repo@v1.2.3")).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      ref: "v1.2.3",
      url: "https://github.com/owner/repo.git",
    });

    expect(parseInstallSource("https://github.com/owner/repo")).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      url: "https://github.com/owner/repo.git",
    });

    expect(parseInstallSource("owner/repo")).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      url: "https://github.com/owner/repo.git",
    });
  });
});
