import { dirname } from "path";
import { fileURLToPath } from "url";

const isDatasourceChild = process.argv.includes("--datasource-child");

if (isDatasourceChild) {
  const { runChild } = await import("../plugins/main/datasource/child-entry");
  await runChild();
} else {
  const { bootstrap } = await import("./app/bootstrap");
  bootstrap({
    mainDir: dirname(fileURLToPath(import.meta.url)),
  });
}
