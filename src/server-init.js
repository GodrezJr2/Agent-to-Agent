import initializeApp from "./shared/services/initializeApp.js";
import { startCronScheduler } from "@/lib/cron/scheduler";

async function startServer() {
  console.log("Starting server...");
  
  try {
    await initializeApp();
    startCronScheduler();
    console.log("Server initialized");
  } catch (error) {
    console.log("Error initializing server:", error);
    process.exit(1);
  }
}

startServer().catch(console.log);

export default startServer;
