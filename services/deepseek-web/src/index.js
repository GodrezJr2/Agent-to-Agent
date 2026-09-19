import { createServer, PORT, HOST, log } from "./server.js";

createServer().listen(PORT, HOST, () => {
  log.info("SERVER", `deepseek-web-api listening on http://${HOST}:${PORT}`);
});
