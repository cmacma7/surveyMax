const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { Expo } = require("expo-server-sdk");
const mongoose = require("mongoose");

//Require additional modules for authentication and email sending.
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// NEW: Use AWS SDK v3 for SES.
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");

// load the environment variables from the .env file
require('dotenv').config();


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

// NEW: Define a Mongoose schema and model for users.
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});
const User = mongoose.model("User", userSchema);

// NEW: Create a transporter for sending emails using Amazon SES.
// Make sure to set AWS_SES_ACCESS_KEY, AWS_SES_SECRET_KEY, AWS_SES_REGION,
// and AWS_SES_EMAIL_FROM in your environment.
const sesClient = new SESClient({
  region: process.env.AWS_SES_REGION, // e.g., 'us-east-1'
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SES_SECRET_KEY,
  },
});
console.log("SES client created:", {
  region: process.env.AWS_SES_REGION, // e.g., 'us-east-1'
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SES_SECRET_KEY,
  }});
const transporter = nodemailer.createTransport({
  SES: { ses: sesClient, aws: { SendRawEmailCommand } },
});

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

// NEW: API endpoint for user registration.
// Expects { email } in the request body. A verification email is sent with a token.
app.post("/api/register", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }
  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ error: "Email already registered." });
    }
    const verificationToken = crypto.randomBytes(20).toString("hex");
    user = new User({ email, verificationToken });
    await user.save();

    // Send verification email with a link to set the password.
    const verificationUrl = `http://yourdomain.com/verify-email?token=${verificationToken}`;
    const mailOptions = {
      from: process.env.AWS_SES_EMAIL_FROM,
      to: email,
      subject: "Email Verification",
      text: `Please verify your email by clicking the following link: ${verificationUrl}`,
    };
    await transporter.sendMail(mailOptions);
    console.log(`Sent verification email to ${email}`);
    return res.status(200).json({ message: "Verification email sent." });
  } catch (err) {
    console.error("Error during registration:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint to verify email and set the password.
// Expects { token, password } in the request body.
app.post("/api/verify-email", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: "Token and password are required." });
  }
  try {
    const user = await User.findOne({ verificationToken: token });
    if (!user) {
      return res.status(400).json({ error: "Invalid token." });
    }
    user.password = await bcrypt.hash(password, 10);
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    console.log(`User ${user.email} verified and password set.`);
    return res.status(200).json({ message: "Email verified and password set." });
  } catch (err) {
    console.error("Error verifying email:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint for user login.
// Expects { email, password } in the request body.
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password." });
    }
    if (!user.isVerified) {
      return res.status(400).json({ error: "Email not verified." });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password." });
    }
    console.log(`User ${email} logged in successfully.`);
    return res.status(200).json({ userId: user._id });
  } catch (err) {
    console.error("Error during login:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint for forgot password.
// Expects { email } in the request body and sends a reset email.
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Email not registered." });
    }
    const resetToken = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour from now
    await user.save();

    const resetUrl = `http://yourdomain.com/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: process.env.AWS_SES_EMAIL_FROM,
      to: email,
      subject: "Password Reset",
      text: `You requested a password reset. Please click the following link to reset your password: ${resetUrl}`,
    };
    await transporter.sendMail(mailOptions);
    console.log(`Sent password reset email to ${email}`);
    return res.status(200).json({ message: "Password reset email sent." });
  } catch (err) {
    console.error("Error in forgot password:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint to reset password.
// Expects { token, newPassword } in the request body.
app.post("/api/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required." });
  }
  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token." });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.isVerified = true; // Automatically verify the email after password reset
    await user.save();
    console.log(`Password reset for user ${user.email}`);
    return res.status(200).json({ message: "Password has been reset." });
  } catch (err) {
    console.error("Error resetting password:", err);
    return res.status(500).json({ error: "Internal server error." });
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
