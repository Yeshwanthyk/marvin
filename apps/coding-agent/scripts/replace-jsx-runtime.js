import { readFile, writeFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const FROM = "@opentui/solid/jsx-runtime";
const TO = "solid-js/h/jsx-runtime";

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (extname(entry.name) !== ".js") {
      continue;
    }
    const contents = await readFile(fullPath, "utf8");
    if (!contents.includes(FROM)) {
      continue;
    }
    const updated = contents.replaceAll(FROM, TO);
    await writeFile(fullPath, updated);
  }
};

await walk(new URL("../dist", import.meta.url).pathname);
