import { dirname } from "path";
import { fileURLToPath } from "url";
import { bootstrap } from "./app/bootstrap";

bootstrap({
  mainDir: dirname(fileURLToPath(import.meta.url)),
});
