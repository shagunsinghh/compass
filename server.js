const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from ./public
app.use(express.static(path.join(__dirname, "public")));

// In‐memory “shared document”
// (This is a very minimal baseline; it will reset if the server restarts.)
let sharedText = "";

// When a client connects:
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Send the current document to the newly connected client
  socket.emit("init-content", sharedText);

  // When a client sends an update (the entire textarea value),
  // broadcast it to everyone (including the sender, so everyone stays in sync).
  socket.on("editor-change", (newText) => {
    sharedText = newText;
    socket.broadcast.emit("remote-edit", newText);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
