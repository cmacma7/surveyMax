const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { Expo } = require("expo-server-sdk");
const mongoose = require("mongoose");

// Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/chatdb", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define a Mongoose schema and model for messages.
const messageSchema = new mongoose.Schema({
  channelId: { type: String, required: true, index: true },
  text: { type: String },
  user: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now },
  _id: { type: String, default: () => uuidv4() },
});
const Message = mongoose.model("Message", messageSchema);

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

// API endpoint to retrieve stored messages for a channel.
app.get("/api/messages/:channelId", async (req, res) => {
  const channelId = req.params.channelId;
  try {
    // Retrieve messages sorted in ascending order (oldest first)
    const messages = await Message.find({ channelId }).sort({ createdAt: 1 });
    res.status(200).json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Socket.IO event handlers.
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Listen for joinRoom event
  socket.on("joinRoom", (channelId) => {
    socket.join(channelId);
    console.log(`Socket ${socket.id} joined room ${channelId}`);
  });

  // When a message is sent from a client.
  socket.on("sendMessage", async (message) => {
    const { channelId } = message;
    if (!channelId) {
      console.error("Message does not contain channelId", message);
      return;
    }

    // Save the message to MongoDB
    try {
      await Message.create(message)

      console.log(`Stored message in channel ${channelId}:`, message);
    } catch (err) {
      console.error("Error saving message:", err);
    }

    // Broadcast the message only to the room (excluding sender)
    socket.to(channelId).emit("receiveMessage", message);
    console.log(`Broadcast message to room ${channelId}`);

    // Prepare remote push notifications for registered devices (if needed)
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
    console.log("User disconnected", socket.id);
  });
});

/**
 * POST /api/send-message endpoint.
 * Accepts a message payload, fills missing fields,
 * then broadcasts the message to the corresponding room and sends push notifications.
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

  // Ensure message contains channelId. You might want to validate this.
  const finalMessage = {
    text: message.text,
    user: {
      _id:
        message.user && message.user._id
          ? message.user._id
          : `user_${Math.random().toString(36).substring(7)}`,
    },
    channelId: message.channelId, // make sure the channelId is passed
    createdAt: message.createdAt || new Date().toISOString(),
    _id: message._id || uuidv4(),
  };

  // Save the message to MongoDB
  try {
    await Message.create(finalMessage)
    console.log("Received message from API:", finalMessage);
  } catch (err) {
    console.error("Error saving message:", err);
  }

  // Broadcast the message to the specific room.
  io.to(finalMessage.channelId).emit("receiveMessage", finalMessage);

  // Prepare remote push notifications for registered devices.
  const messagesToSend = [];
  for (const [userId, token] of Object.entries(pushTokens)) {
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
