/**
 * io.js
 *
 * Singleton Socket.IO server instance.
 * Call `initIO(httpServer)` once from server.js, then import `getIO()` anywhere.
 */
import { Server } from "socket.io";

let io = null;

export function initIO(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log(`[socket.io] client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`[socket.io] client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  return io;
}
