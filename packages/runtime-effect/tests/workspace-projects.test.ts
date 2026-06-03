import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverWorkspaceProjects } from "../src/workspace-projects.js";

describe("workspace projects", () => {
  it("discovers visible child folders at configured depth", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workspace-projects-"));
    try {
      await mkdir(path.join(root, "nora"));
      await mkdir(path.join(root, "marvin"));
      await mkdir(path.join(root, ".hidden"));
      await mkdir(path.join(root, "nora", "nested"));

      const projects = discoverWorkspaceProjects([{ path: root, depth: 1 }]);

      expect(projects.map((project) => project.title)).toEqual(["marvin", "nora"]);
      expect(projects.map((project) => project.cwd)).toEqual([
        path.join(root, "marvin"),
        path.join(root, "nora"),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports depth zero as the root itself", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workspace-projects-"));
    try {
      const projects = discoverWorkspaceProjects([{ path: root, depth: 0 }]);

      expect(projects).toEqual([
        {
          cwd: root,
          title: path.basename(root),
          root: path.dirname(root),
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
