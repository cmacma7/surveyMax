const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { Expo } = require("expo-server-sdk");

// Initialize Express and HTTP server.
const app = express();
app.use(express.json());
app.use(cors());
const server = http.createServer(app);

// Create Socket.IO server with a large payload limit.
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100 MB in bytes
});

// In-memory storage for push tokens (userId => token).
const pushTokens = {};

// Initialize Expo SDK client.
let expo = new Expo();

// API endpoint to register a device's push token.
app.post("/api/register-push-token", (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) {
    return res.status(400).json({ error: "userId and token are required." });
  }
  pushTokens[userId] = token;
  console.log(`Registered push token for user ${userId}: ${token}`);
  return res.status(200).json({ success: true });
});

// Socket.IO event handlers.
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // When a message is sent from a client.
  socket.on("sendMessage", async (message) => {
    // Broadcast the message to all other connected clients.
    socket.broadcast.emit("receiveMessage", message);
    console.log("Received message from socket:", message);

    // Prepare remote push notifications for all registered devices except the sender.
    const messagesToSend = [];
    for (const [userId, token] of Object.entries(pushTokens)) {
      // Skip sending a push notification to the sender.
      if (userId === message.user._id) continue;
      if (!Expo.isExpoPushToken(token)) {
        console.error(`Push token ${token} is not a valid Expo push token`);
        continue;
      }
      messagesToSend.push({
        to: token,
        sound: "default",
        title: "New Message",
        body: message.text ? message.text : "You received an image or document",
        data: { message },
      });
    }

    // Chunk the notifications and send them.
    const chunks = expo.chunkPushNotifications(messagesToSend);
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log("Push notification ticket:", ticketChunk);
      } catch (error) {
        console.error(error);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

/**
 * POST /api/send-message endpoint.
 * Accepts a message payload, fills missing fields,
 * then broadcasts the message to all connected clients
 * and sends push notifications to registered devices.
 */
app.post("/api/send-message", async (req, res) => {
  let { message } = req.body;

  if (!message.text) {
    if (typeof message === "string") {
      message = { text: message };
    } else {
      return res
        .status(400)
        .json({ error: 'Missing "text" field in the message.' });
    }
  }

  const finalMessage = {
    text: message.text,
    user: {
      _id:
        message.user && message.user._id
          ? message.user._id
          : `user_${Math.random().toString(36).substring(7)}`,
    },
    createdAt: message.createdAt || new Date().toISOString(),
    _id: message._id || uuidv4(),
  };

  console.log("Received message from API:", finalMessage);
  io.emit("receiveMessage", finalMessage);

  // Prepare remote push notifications for all registered devices except the sender.
  const messagesToSend = [];
  for (const [userId, token] of Object.entries(pushTokens)) {
    // Skip sending a push notification to the sender.
    if (userId === finalMessage.user._id) continue;
    if (!Expo.isExpoPushToken(token)) {
      console.error(`Push token ${token} is not a valid Expo push token`);
      continue;
    }
    messagesToSend.push({
      to: token,
      sound: "default",
      title: "New Message",
      body: finalMessage.text ? finalMessage.text : "You received an image",
      data: { message: finalMessage },
    });
  }

  // Chunk the notifications and send them.
  const chunks = expo.chunkPushNotifications(messagesToSend);
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log("Push notification ticket:", ticketChunk);
    } catch (error) {
      console.error(error);
    }
  }

  return res.status(200).json({
    success: true,
    broadcasted: finalMessage,
  });
});

// Start the server.
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
