const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { Expo } = require("expo-server-sdk");
const mongoose = require("mongoose");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

//Require additional modules for authentication and email sending.
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// NEW: Use AWS SDK v3 for SES.
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");
// NEW: Require JSON Web Token package.
const jwt = require("jsonwebtoken");

// load the environment variables from the .env file
require('dotenv').config();


// API server base URL:  This is used by email verifier for the link that user can click to verify email 
const BASE_URL = 'http://b200.tagfans.com:5300';

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


// Define a Mongoose schema for general data (e.g., surveys)
// Using { strict: false } allows us to store any additional fields sent in the payload.
const generalDataSchema = new mongoose.Schema({
  _id: { type: String, default: () => uuidv4() },
  _type: { type: String, required: true },
  _channelId: { type: String },
  _storeId: { type: String }
}, { strict: false });

const GeneralData = mongoose.model("GeneralData", generalDataSchema);


// Define a Mongoose schema and model for users.
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});
const User = mongoose.model("User", userSchema);


// Define a Mongoose schema and model for channelInfo.
const channelInfoSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true, index: true },
  channelDescription: { type: String },
});
const ChannelInfo = mongoose.model("ChannelInfo", channelInfoSchema);

// Define a Mongoose schema and model for adminChannels.
const adminChannelSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  channels: { type: [String], default: [] },
  // Modified: Allow multiple push tokens per user.
  pushTokens: { type: [String], default: [] },
});
const AdminChannel = mongoose.model("AdminChannel", adminChannelSchema);



// Mongoose schema for survey schemas. 
const surveySchema = new mongoose.Schema({
  _id: { type: String, default: () => uuidv4() },
  _storeId: { type: String },
  _channelId: { type: String },
  _userId: { type: String, required: true },    // the create user's id
  surveyTitle: { type: String },
  bannerImage: { type: String },
  surveyItems: { type: Array, default: [] },
  counter: { type: Number, default: 0 }
}, { timestamps: true });

const SurveySchema = mongoose.model("SurveySchema", surveySchema);





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
  region: process.env.AWS_SES_REGION,
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SES_SECRET_KEY,
  }
});
const transporter = nodemailer.createTransport({
  SES: { ses: sesClient, aws: { SendRawEmailCommand } },
});

// Initialize Express and HTTP server.
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
const server = http.createServer(app);

// Create Socket.IO server with a large payload limit.
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100 MB in bytes
});



// Initialize Expo SDK client.
let expo = new Expo();


// ########### AWS S3 ################

// Configure the S3 client using your AWS credentials and region
const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION ,
  credentials: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY,
    secretAccessKey: process.env.AWS_S3_SECRET_KEY,
  },
});

// Your S3 bucket name (set this in your .env file or here directly)
const bucketName = process.env.AWS_S3_BUCKET_NAME;
console.log(bucketName);




// ********** API Endpoints **********
// ***********************************

// API endpoint to register a device's push token.
app.post("/api/register-push-token", async (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) {
    return res.status(400).json({ error: "userId and token are required." });
  }
  try {
    // Update or create the AdminChannel record to include the push token.
    // Using $addToSet to prevent duplicates.
    await AdminChannel.findOneAndUpdate(
      { userId },
      { $addToSet: { pushTokens: token } },
      { upsert: true, new: true }
    );
    console.log(`Registered push token for user ${userId}: ${token}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error registering push token:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
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
    const verificationUrl = `${BASE_URL}/verify-email?token=${verificationToken}`;
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

// GET endpoint to render the email verification page (set password)
app.get("/verify-email", (req, res) => {
  // Get the verification token from the query parameters
  const token = req.query.token || "";
  
  // Build an HTML page with a form that allows the user to set a password.
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email</title>
      <style>
          body {
              margin: 0;
              padding: 0;
              font-family: Arial, sans-serif;
              background-color: #f7f7f7;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
          }
          .container {
              background-color: #fff;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              max-width: 400px;
              width: 90%;
          }
          h1 {
              text-align: center;
              color: #333;
              margin-bottom: 20px;
          }
          label {
              display: block;
              margin: 10px 0 5px;
              color: #555;
          }
          input[type="password"] {
              width: 100%;
              padding: 10px;
              margin-bottom: 15px;
              border: 1px solid #ccc;
              border-radius: 4px;
              box-sizing: border-box;
          }
          button {
              width: 100%;
              padding: 10px;
              background-color: #4CAF50;
              color: white;
              border: none;
              border-radius: 4px;
              font-size: 16px;
              cursor: pointer;
          }
          button:hover {
              background-color: #45a049;
          }
          @media (max-width: 480px) {
              .container {
                  padding: 15px;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>Verify Your Email</h1>
          <form action="/api/verify-email" method="POST">
              <input type="hidden" name="token" value="${token}" />
              <label for="password">Set Password</label>
              <input type="password" name="password" id="password" placeholder="Enter your new password" required />
              <button type="submit">Verify Email</button>
          </form>
      </div>
  </body>
  </html>
  `;
  
  res.send(html);
});


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
    // NEW: Generate JWT token so that the user stays logged in.
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    console.log(`User ${email} logged in successfully.`);
    // Return both token and userId for client usage.
    return res.status(200).json({ token, userId: user._id });
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

    const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`; // http get reset-password
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

// This is the http get, to show a page to collect new password, then issue api/reset-password again
app.get("/reset-password", (req, res) => {
  // Get the reset token from the query parameters
  const token = req.query.token || "";
  
  // Build the HTML string with inline CSS for responsiveness and a modern look.
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password</title>
      <style>
          body {
              margin: 0;
              padding: 0;
              font-family: Arial, sans-serif;
              background-color: #f7f7f7;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
          }
          .container {
              background-color: #fff;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              max-width: 400px;
              width: 90%;
          }
          h1 {
              text-align: center;
              color: #333;
              margin-bottom: 20px;
          }
          label {
              display: block;
              margin: 10px 0 5px;
              color: #555;
          }
          input[type="password"] {
              width: 100%;
              padding: 10px;
              margin-bottom: 15px;
              border: 1px solid #ccc;
              border-radius: 4px;
              box-sizing: border-box;
          }
          button {
              width: 100%;
              padding: 10px;
              background-color: #4CAF50;
              color: white;
              border: none;
              border-radius: 4px;
              font-size: 16px;
              cursor: pointer;
          }
          button:hover {
              background-color: #45a049;
          }
          @media (max-width: 480px) {
              .container {
                  padding: 15px;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>Reset Your Password</h1>
          <form action="/api/reset-password" method="POST">
              <input type="hidden" name="token" value="${token}" />
              <label for="newPassword">New Password</label>
              <input type="password" name="newPassword" id="newPassword" placeholder="Enter your new password" required />
              <button type="submit">Reset Password</button>
          </form>
      </div>
  </body>
  </html>
  `;
  
  // Send the HTML back to the client
  res.send(html);
});


// Expects { token, newPassword } in the request body.
app.post("/api/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  console.log(req.body);
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

// NEW: Endpoint to update or delete a channel in channelInfo.
app.post("/api/update-channel", async (req, res) => {
  const { channelId, channelDescription, deleteChannel } = req.body;
  if (!channelId) {
    return res.status(400).json({ error: "channelId is required." });
  }
  try {
    if (deleteChannel === "Yes") {
      await ChannelInfo.findOneAndDelete({ channelId });
      console.log(`Channel ${channelId} deleted.`);
      return res.status(200).json({ message: "Channel deleted." });
    } else {
      const update = { channelDescription };
      const options = { upsert: true, new: true, setDefaultsOnInsert: true };
      const channel = await ChannelInfo.findOneAndUpdate({ channelId }, update, options);
      console.log(`Channel ${channelId} updated/created:`, channel);
      return res.status(200).json({ message: "Channel updated/created.", channel });
    }
  } catch (err) {
    console.error("Error in updateChannel:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: Endpoint to add or remove a channel from a user's admin channels.
app.post("/api/add-channel-admin", async (req, res) => {
  let { channelId, userId, email, deleteAdmin } = req.body;
  if (!channelId) {
    return res.status(400).json({ error: "channelId is required." });
  }
  if (!userId && !email) {
    return res.status(400).json({ error: "Either userId or email is required." });
  }
  try {
    if (!userId && email) {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ error: "User not found with provided email." });
      }
      userId = user._id;
    }
    // Find or create admin channel doc for the user.
    let adminDoc = await AdminChannel.findOne({ userId });
    if (!adminDoc) {
      adminDoc = new AdminChannel({ userId, channels: [] });
    }
    if (deleteAdmin === "Yes") {
      adminDoc.channels = adminDoc.channels.filter(id => id !== channelId);
      console.log(`Channel ${channelId} removed from admin list for user ${userId}`);
    } else {
      if (!adminDoc.channels.includes(channelId)) {
        adminDoc.channels.push(channelId);
        console.log(`Channel ${channelId} added to admin list for user ${userId}`);
      }
    }
    await adminDoc.save();
    return res.status(200).json({ message: "Admin channels updated.", adminChannels: adminDoc });
  } catch (err) {
    console.error("Error in addChannelAdmin:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: Endpoint to list all channels that a user can admin.
app.post("/api/list-admin", async (req, res) => {
  let { userId, email } = req.body;
  if (!userId && !email) {
    return res.status(400).json({ error: "Either userId or email is required." });
  }
  try {
    if (!userId && email) {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ error: "User not found with provided email." });
      }
      userId = user._id;
    }
    const adminDoc = await AdminChannel.findOne({ userId });
    if (!adminDoc || adminDoc.channels.length === 0) {
      return res.status(200).json({ channels: [] });
    }
    // Get channel info from channelInfo collection.
    const channels = await ChannelInfo.find({ channelId: { $in: adminDoc.channels } });
    return res.status(200).json({ channels });
  } catch (err) {
    console.error("Error in listAdmin:", err);
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
    const adminDocs = await AdminChannel.find({ channels: channelId });
    const messagesToSend = [];
    adminDocs.forEach(doc => {
      // Skip sending a push notification to the sender.
      if (doc.userId === message.user._id) return;
      // Iterate over each push token for the user.
      doc.pushTokens.forEach(token => {
        if (!Expo.isExpoPushToken(token)) {
          console.error(`Push token ${token} is not a valid Expo push token`);
          return;
        }
        messagesToSend.push({
          to: token,
          sound: "default",
          title: "New Message",
          body: message.text ? message.text : "You received an image or document",
          data: { message },
        });
      });
    });
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
  // Query AdminChannel for tokens of users admining the room.
  const adminDocs = await AdminChannel.find({ channels: finalMessage.channelId });
  const messagesToSend = [];
  adminDocs.forEach(doc => {
    if (doc.userId === finalMessage.user._id) return;
    doc.pushTokens.forEach(token => {
      if (!Expo.isExpoPushToken(token)) {
        console.error(`Push token ${token} is not a valid Expo push token`);
        return;
      }
      messagesToSend.push({
        to: token,
        sound: "default",
        title: "New Message",
        body: finalMessage.text ? finalMessage.text : "You received an image",
        data: { message: finalMessage },
      });
    });
  });
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


// NEW: API endpoint to handle general data submissions (e.g., surveys)
app.post("/api/send-data", async(req, res) => {
    // The client must send data with at least a _type and a _channelId field.
    const payload = req.body;
    if (!payload._type) {
        return res.status(400).json({
            error: "_type field is required."
        });
    }

    if (payload._type == 'survey') {
      const survey = await SurveySchema.findOne({
          _id: payload.surveyId
      });
      if (!survey) {
          return res.status(400).json({
              error: "Invalid survey id."
          });
      }
    }
    // NEW: Check if the provided _channelId exists in ChannelInfo
    /*
    const channel = await ChannelInfo.findOne({
        channelId: payload._channelId
    });
    if (!channel) {
        return res.status(400).json({
            error: "Invalid channel id."
        });
    }
    */
    // Always generate a new unique _id for the document,
    // even if an _id was provided by the client.
    payload._id = uuidv4();

    try {
        const newData = new GeneralData(payload);
        await newData.save();
        console.log(`Saved ${payload._type} data with id ${payload._id}`);
        return res.status(200).json({
            success: true,
            data: newData
        });
    } catch (err) {
        console.error("Error saving general data:", err);
        return res.status(500).json({
            error: "Internal server error."
        });
    }
});

// NEW: API endpoint to read general data based on _channelId, _storeId, and _type
app.get("/api/read-data", async (req, res) => {
  const { _channelId, _storeId, _type } = req.query;

  // Ensure at least one filter parameter is provided
  if (!_channelId && !_storeId && !_type) {
    return res.status(400).json({ error: "At least one filter parameter is required." });
  }

  try {
    // Build the query object dynamically based on provided parameters
    let query = {};
    if (_channelId) query._channelId = _channelId;
    if (_storeId) query._storeId = _storeId;
    if (_type) query._type = _type;

    // Fetch matching records from MongoDB
    const results = await GeneralData.find(query);

    if (results.length === 0) {
      return res.status(200).json({ message: "No matching data found.", data: [] });
    }

    console.log(`Fetched ${results.length} records`);
    return res.status(200).json({ success: true, data: results });

  } catch (err) {
    console.error("Error fetching general data:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ***** Survey operations *****
// GET a specific survey schema by id.
app.get("/api/survey/:id", async (req, res) => {
  try {
    const survey = await SurveySchema.findById(req.params.id);
    if (!survey) return res.status(404).json({ error: "Survey not found" });
    return res.json(survey);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET list of surveys filtered by storeId (optional).
app.get("/api/survey", async (req, res) => {
  try {
    const { userId } = req.query;
    let query = {};
    if (userId) query._userId = userId;
    const surveys = await SurveySchema.find(query);
    return res.json(surveys);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST to create a new survey schema.
app.post("/api/survey", async (req, res) => {
  try {
    const content = req.body;
    const newSurvey = new SurveySchema(content);
    await newSurvey.save();
    return res.status(201).json(newSurvey);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT to update an existing survey schema.
app.put("/api/survey/:id", async (req, res) => {
  try {
    const updatedSurvey = await SurveySchema.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedSurvey) return res.status(404).json({ error: "Survey not found" });
    return res.json(updatedSurvey);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH to increment a counter in the survey schema.
app.patch("/api/survey/:id/counter", async (req, res) => {
  try {
    const updatedSurvey = await SurveySchema.findByIdAndUpdate(
      req.params.id,
      { $inc: { counter: 1 } },
      { new: true }
    );
    if (!updatedSurvey) return res.status(404).json({ error: "Survey not found" });
    return res.json(updatedSurvey);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



// ***** AWS S3 operations ******
// Endpoint to generate a presigned URL for PUT (upload)
app.get("/presigned-url/put", async (req, res) => {
  const key = req.query.key;
  if (!key) {
    return res.status(400).json({ error: "Missing key query parameter" });
  }
  console.log(bucketName, key);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: "image/jpeg", // adjust if needed or pass from client
  });

  try {
    // The URL will expire in 5 minutes (300 seconds)
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    res.json({ signedUrl });
  } catch (error) {
    console.error("Error generating PUT presigned URL:", error.message);
    console.error(error);
    res.status(500).json({ error: "Error generating presigned URL", details: error.message });
  }
});

// Endpoint to generate a presigned URL for GET (download/view)
app.get("/presigned-url/get", async (req, res) => {
  const key = req.query.key;
  if (!key) {
    return res.status(400).json({ error: "Missing key query parameter" });
  }
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  try {
    // The URL will expire in 5 minutes (300 seconds)
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    res.json({ signedUrl });
  } catch (error) {
    console.error("Error generating GET presigned URL:", error.message);
    console.error(error);
    res.status(500).json({ error: "Error generating presigned URL", details: error.message });
  }
});
















// Start the server.
server.listen(5300, () => {
  console.log("Server running on http://localhost:5300");
});
