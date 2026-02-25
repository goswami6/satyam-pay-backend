require("dotenv").config();   // 👈 Sabse pehle

const cluster = require("cluster");
const os = require("os");
const app = require("./src/app");

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";
const numCPUs = os.cpus().length;

// ✅ Use cluster mode in production for better performance
if (process.env.NODE_ENV === "production" && cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  console.log(`Starting ${numCPUs} workers...`);

  // Fork workers based on CPU count (max 4 for free tier servers)
  const workerCount = Math.min(numCPUs, 4);
  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });

} else {
  // Workers can share any TCP connection
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT} (PID: ${process.pid})`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });

  // ✅ Optimize server timeouts
  server.keepAliveTimeout = 65000; // Slightly higher than ALB's 60s
  server.headersTimeout = 66000;

  // Graceful shutdown handling
  const gracefulShutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log("HTTP server closed.");
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.log("Forcing shutdown...");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
