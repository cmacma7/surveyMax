const express = require("express");
const http = require("http");
const request = require('request');
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { Expo } = require("expo-server-sdk");
const mongoose = require("mongoose");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Require additional modules for authentication and email sending.
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// NEW: Use AWS SDK v3 for SES.
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");
// NEW: Require JSON Web Token package.
const jwt = require("jsonwebtoken");
const { VM } = require('vm2');

// used by llm 
const { Configuration, OpenAIApi } = require('openai');

// load the environment variables from the .env file
require('dotenv').config();

// API server base URL:  This is used by email verifier for the link that user can click to verify email 
const BASE_URL = 'http://b200.tagfans.com:5300';

// Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/chatdb", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Message Schema
const messageSchema = new mongoose.Schema({
  channelId: { type: String, required: true, index: true },
  text: { type: String },
  user: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now },
  image: { type: String },
  _id: { type: String, default: () => uuidv4() },
});
messageSchema.index({ channelId: 1, createdAt: 1 });
const Message = mongoose.model("Message", messageSchema);

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});
const User = mongoose.model("User", userSchema);

// ChannelInfo schema
const channelInfoSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true, index: true },
  channelDescription: { type: String },
});
const ChannelInfo = mongoose.model("ChannelInfo", channelInfoSchema);

// AdminChannels schema, the channels that a specific user can admin
const adminChannelSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  channels: { type: [String], default: [] },
  // Modified: Allow multiple push tokens per user.
  pushTokens: { type: [String], default: [] },
  mutedChannels: { type: [String], default: [] }, //  muted channels
});
const AdminChannel = mongoose.model("AdminChannel", adminChannelSchema);

// Data schema. It create a data basing on a prototype. 
// For example, a survey (_type is 'survey') that filled by a users, base on a survey prototype who's id if _typeId.
const generalDataSchema = new mongoose.Schema({
  _id: { type: String, default: () => uuidv4() },
  _type: { type: String, required: true },
  _typeId:  { type: String, required: true },   // the _typeId is the corresponding
  _channelId: { type: String },
  _storeId: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { strict: false });

// 在 schema 上新增複合索引：(_typeId 先、createdAt 後)
generalDataSchema.index({ _typeId: 1, createdAt: 1 });

const GeneralData = mongoose.model("GeneralData", generalDataSchema);

// Survey prototype. 
const surveySchema = new mongoose.Schema({
  _id: { type: String, default: () => uuidv4() },
  _userId: { type: String, required: true },    // the create user's id
  _storeId: { type: String },
  _channelId: { type: String },
  surveyTitle: { type: String },
  bannerImage: { type: String },
  surveyItems: { type: Array, default: [] },
  counter: { type: Number, default: 0 },
  eventTriggers: [{
    name: String,
    conditionType: String, // "starThreshold", "answerMatch", "timeBased"
    parameters: mongoose.Schema.Types.Mixed,
    script: String,
    createdAt: { type: Date, default: Date.now }
  }]
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

app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//app.use(cors());

app.use(cors({
  origin: ["https://b200.tagfans.com", "http://b200.tagfans.com", "https://eat.tagfans.com", "http://eat.tagfans.com", "http://127.0.0.1:8081","http://localhost:8081"], // Allow frontend domains
  credentials: true // Allows cookies to be sent with requests
}));

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
  region: process.env.AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY,
    secretAccessKey: process.env.AWS_S3_SECRET_KEY,
  },
});

// Your S3 bucket name (set this in your .env file or here directly)
const bucketName = process.env.AWS_S3_BUCKET_NAME;
console.log(bucketName);

// ---------------------------------------------------
// NEW: Authentication Middleware
// This middleware requires that the request carries a valid JWT token
// in the Authorization header and that the token's userId matches the provided userId.
function authenticateToken(req, res, next) {

  // we have cookie and body both has the userId and userToken
  let token = req.cookies.userToken; // ✅ Check HttpOnly cookie first

  // Extract token from Authorization header (expected format: "Bearer <token>")
  if (!token){
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ error: "Token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    // Extract `userId` from headers
    let requestUserId = req.cookies.userId; // ✅ Check HttpOnly cookie first

    if (!requestUserId) requestUserId = req.headers["x-user-id"];
    
    // Validate that the provided `X-User-Id` matches the token's `userId`
    if (!requestUserId || requestUserId !== decoded.userId) {
      return res.status(403).json({ error: "User ID mismatch or missing" });
    }

    // Attach authenticated user info to request
    req.user = decoded; // `decoded.userId` contains the authenticated user ID

    next(); // Proceed to the next middleware or route handler
  });
}

// ---------------------------------------------------

// ********** API Endpoints **********

// Protected endpoints now include the authenticateToken middleware

// API endpoint to register a device's push token. (Protected)
app.post("/api/register-push-token", authenticateToken, async (req, res) => {
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

// API endpoint to retrieve stored messages for a channel. (Protected)
app.get("/api/messages/:channelId", authenticateToken, async (req, res) => {
  const channelId = req.params.channelId;
  const after = req.query.after;
  let filter = { channelId };
  
  // If an "after" timestamp is provided, add a condition on createdAt.
  if (after) {
    // Ensure "after" is parsed as a Date.
    filter.createdAt = { $gt: new Date(after) };
  }
  
  try {
    // Retrieve messages sorted in ascending order (oldest first)
    const messages = await Message.find(filter).sort({ createdAt: 1 });
    res.status(200).json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// server.js
app.post("/api/messages/counts", authenticateToken, async (req, res) => {
  const queries = req.body.queries; // Expect an array of { channelId, after, excludeUserId }
  if (!queries || !Array.isArray(queries)) {
    return res.status(400).json({ error: "Invalid queries format. Expected an array." });
  }
  
  try {
    // For each query, count messages by channel that are newer than the 'after' timestamp.
    // If an excludeUserId is provided, exclude messages sent by that user.
    const counts = await Promise.all(
      queries.map(async (q) => {
        const filter = {
          channelId: q.channelId,
          createdAt: { $gt: new Date(q.after) },
        };
        if (q.excludeUserId) {
          // Exclude messages sent by the specified user.
          filter["user._id"] = { $ne: q.excludeUserId };
        }
        const count = await Message.countDocuments(filter);
        return { channelId: q.channelId, count };
      })
    );
    
    return res.status(200).json({ counts });
  } catch (err) {
    console.error("Error counting messages for multiple channels:", err);
    return res.status(500).json({ error: "Failed to count unread messages" });
  }
});




// NEW: API endpoint for user registration. (Public)
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
      html: 
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Email Verification</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    .language-section { margin-bottom: 40px; }
    .cta-button {
      display: inline-block;
      padding: 10px 20px;
      background-color: orange;
      color: #f0f0f0;
      text-decoration: none;
      border-radius: 4px;
    }
    hr { border: none; border-top: 1px solid #ddd; margin: 40px 0; }
  </style>
</head>
<body>
  <!-- English Section -->
  <div class="language-section">
    <h1>Welcome to Our Service</h1>
    <p>Please verify your email by clicking the button below:</p>
    <p><a class="cta-button" href="${verificationUrl}">Verify Email</a></p>
  </div>
  
  <hr />

  <!-- Chinese Section -->
  <div class="language-section">
    <h1>欢迎使用我们的服务</h1>
    <p>请点击下面的按钮验证您的邮箱：</p>
    <p><a class="cta-button" href="${verificationUrl}">验证邮箱</a></p>
  </div>

  <hr />

  <!-- Japanese Section -->
  <div class="language-section">
    <h1>私たちのサービスへようこそ</h1>
    <p>以下のボタンをクリックしてメールを確認してください：</p>
    <p><a class="cta-button" href="${verificationUrl}">メール確認</a></p>
  </div>

  <p style="font-size: 12px; color: #666;">If you're having trouble, please copy and paste the link into your browser.</p>
</body>
</html>
`,
      text: `[English] Please verify your email here: ${verificationUrl}
    
    [中文] 请点击以下链接验证您的邮箱: ${verificationUrl}
    
    [日本語] 以下のリンクをクリックしてメールを確認してください: ${verificationUrl}`
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
// GET endpoint to render the email verification page (set password) (Public)
// Modified GET /verify-email endpoint in server.js
app.get("/verify-email", (req, res) => {
  const token = req.query.token || "";

  // Render a modern responsive page similar to the reset-password flow.
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
      input[type="password"],
      input[type="hidden"] {
        width: 100%;
        font-size: 16px;
        padding: 10px;
        margin-bottom: 15px;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-sizing: border-box;
      }
      button {
        width: 100%;
        padding: 10px;
        background-color: #4caf50;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        cursor: pointer;
      }
      button:hover {
        background-color: #45a049;
      }
      #message {
        margin-top: 15px;
        text-align: center;
        font-weight: bold;
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
      <form id="verifyForm" action="/api/verify-email" method="POST">
        <input type="hidden" name="token" value="${token}" />
        <label for="password">Set Password</label>
        <input type="password" name="password" id="password" placeholder="Enter your new password" required />
        <button type="submit">Verify Email</button>
      </form>
      <div id="message"></div>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('verifyForm');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(form);
          const formObj = Object.fromEntries(formData.entries());
          const messageDiv = document.getElementById('message');
          try {
            const response = await fetch(form.action, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(formObj)
            });
            const result = await response.json();
            if (result.message && result.message.includes("verified")) {
              form.style.display = 'none';
              messageDiv.innerHTML = '<p style="color: green;">Email verified and password set successfully!</p><p><a href="surveyMax://login">Click here to open the App</a></p>';
            } else {
              messageDiv.innerHTML = '<p style="color: red;">Verification failed: ' +
                (result.error || 'An error occurred.') + '</p>';
            }
          } catch (error) {
            messageDiv.innerHTML = '<p style="color: red;">An error occurred. Please try again later.</p>';
          }
        });
      });
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// Expects { token, password } in the request body. (Public)
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

// NEW: API endpoint for user login. (Public)
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

    // ✅ Store in HttpOnly Cookie (new method)
    res.cookie("userToken", token, {
      httpOnly: false,
      secure: true,
      sameSite: "None",
      domain: ".tagfans.com", // Allows sharing across subdomains
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/" 
    });

    res.cookie("userId", user._id, {
      httpOnly: false,
      secure: true,
      sameSite: "None",
      domain: ".tagfans.com",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/" 
    });

    // ✅ Return token and userId for client usage to store in localStorage (old method).
    return res.status(200).json({ token, userId: user._id });
  } catch (err) {
    console.error("Error during login:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint for user logout. (public)
// Expects { userId, token } in the request body. Here token is the pushToken, not the userToken
// Removes the specified push token from the user's AdminChannel record.
app.post("/api/logout", async (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) {
    // clear cookie (new method)
    if (!token) {
      res.clearCookie("userToken", { domain: ".tagfans.com", path: "/" });
      res.clearCookie("userId", { domain: ".tagfans.com", path: "/" });
      return res.status(200).json({ success: true, message: "Anonymous Logout successful" });
    }
    else {
      return res.status(400).json({ error: "userId and token are required." });
    }
  }
  try {
    // Remove the provided push token from the user's pushTokens array
    const updatedAdmin = await AdminChannel.findOneAndUpdate(
      { userId },
      { $pull: { pushTokens: token } },
      { new: true }
    );
    
    if (!updatedAdmin) {
      return res.status(404).json({ error: "User not found or no push tokens to remove." });
    }
    
    // clear cookie (new method)
    res.clearCookie("userToken", { domain: ".tagfans.com", path: "/" });
    res.clearCookie("userId", { domain: ".tagfans.com", path: "/" });
  

    console.log(`Removed push token ${token} for user ${userId}`);
    return res.status(200).json({ success: true, message: "Logout successful" });
  } catch (err) {
    console.error("Error during logout:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint for forgot password. (Public)
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

    const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`;
    const resetUrl_device = `surveyMax://reset-password?token=${resetToken}`;
    const mailOptions = {
      from: process.env.AWS_SES_EMAIL_FROM,
      to: email,
      subject: "Password Reset",
      html: `
        <p>You requested a password reset. Please click the link below to reset your password:</p>
        <p><a href="${resetUrl}">Reset Password</a></p>
        
        <p>After resetting your password, return to your device’s login screen and sign in again.</p>
        
        <br/>
        <p>Alternatively, you can enter the reset token along with your new password on your phone to complete the process.</p>
        <p>Your reset token is: <strong>${resetToken}</strong></p>
      `,
      text: 
`
You requested a password reset. Please click the link below to reset your password:
${resetUrl_device}
After resetting your password, return to your device’s login screen and sign in again.

Alternatively, you can enter the reset token along with your new password on your phone to complete the process.
Your reset token is: ${resetToken}
`,
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
// GET endpoint to render the password reset page (Public)
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
    input[type="password"],
    input[type="hidden"] {
      width: 100%;
      font-size: 16px;
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
    #message {
      margin-top: 15px;
      text-align: center;
      font-weight: bold;
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
    <form id="resetForm" action="/api/reset-password" method="POST">
      <input type="hidden" name="token" value="${token}" />
      <label for="newPassword">New Password</label>
      <input type="password" name="newPassword" id="newPassword" placeholder="Enter your new password" required />
      <button type="submit">Reset Password</button>
    </form>
    <div id="message"></div>
  </div>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      const form = document.getElementById('resetForm');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        
        // Debug: log each form field key and value
        for (let [key, value] of formData.entries()) {
          console.log(key, value);
        }
        const formObj = Object.fromEntries(formData.entries());

        const messageDiv = document.getElementById('message');
        
        try {
          const response = await fetch(form.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formObj)
          });
          
          const result = await response.json();
          
          if (result.success) {
            form.style.display = 'none';
            messageDiv.innerHTML = '<div><p style="color: green;">Password reset successfully!</p><a href="surveyMax://login">Open the App</a></div>';
          } else {
            messageDiv.innerHTML = '<p style="color: red;">Password reset failed: ' +
              (result.message || 'An error occurred.') + '</p>';
          }
        } catch (error) {
          messageDiv.innerHTML = '<p style="color: red;">An error occurred. Please try again later.</p>';
        }
      });
    });
  </script>
</body>
</html>
  `;
  
  // Send the HTML back to the client
  res.send(html);
});

// Expects { token, newPassword } in the request body. (Public)
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
    return res.status(200).json({ message: "Password has been reset.", success: true });
  } catch (err) {
    console.error("Error resetting password:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint to update or delete a channel in channelInfo. (Protected)
app.post("/api/update-channel", authenticateToken, async (req, res) => {
  // NEW: If channelId is not provided, generate a new one.
  let { channelId, channelDescription, deleteChannel } = req.body;
  if (!channelId) {
    channelId = uuidv4();
    req.body.channelId = channelId;
  }
  try {
    if (deleteChannel === "Yes") {
      await ChannelInfo.findOneAndDelete({ channelId });
      console.log(`Channel ${channelId} deleted.`);
      //io.emit("chatroomsUpdated");
      return res.status(200).json({ message: "Channel deleted." });
    } else {
      const update = { channelDescription };
      const options = { upsert: true, new: true, setDefaultsOnInsert: true };
      const channel = await ChannelInfo.findOneAndUpdate({ channelId }, update, options);
      //io.emit("chatroomsUpdated");
      console.log(`Channel ${channelId} updated/created:`, channel);
      return res.status(200).json({ message: "Channel updated/created.", channel });
    }
  } catch (err) {
    console.error("Error in updateChannel:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint to add or remove a channel from a user's admin channels. (Protected)
app.post("/api/add-channel-admin", authenticateToken, async (req, res) => {
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
    //io.emit("chatroomsUpdated");
    return res.status(200).json({ message: "Admin channels updated.", adminChannels: adminDoc });
  } catch (err) {
    console.error("Error in addChannelAdmin:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// Get channel info by channel id.
// Optionally, add 'authenticateToken' middleware if you want to protect this endpoint.
app.get("/api/channel-info", async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) {
    return res.status(400).json({ error: "Channel id is required." });
  }
  try {
    const channelInfo = await ChannelInfo.findOne({ channelId });
    if (!channelInfo) {
      return res.status(404).json({ error: "Channel not found." });
    }
    // Return the channel name from channelDescription.
    return res.status(200).json({ channelName: channelInfo.channelDescription });
  } catch (error) {
    console.error("Error fetching channel info:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});


// NEW: API endpoint to list all channels that a user can admin. (Protected)
app.post("/api/list-admin", authenticateToken, async (req, res) => {
  let { userId, email } = req.body;
  if (!userId && req.cookies.userId) userId = req.cookies.userId;
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
    console.log(adminDoc);
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
  socket.on("sendMessage", async (message, callback) => {
    const { channelId } = message;
    if (!channelId) {
      console.error("Message does not contain channelId", message);
      callback({ error: "Missing channelId" });
      return;
    }
    // Process the message (e.g., save to database, broadcast, etc.)
    // Then call the callback to acknowledge success:
    callback({ success: true });
    sendAndNotify(socket, channelId, message);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected", socket.id);
  });
});

// API endpoint to mute/unmute a channel. (Protected)
app.post("/api/channel-mute", authenticateToken, async (req, res) => {
  const { userId, channelId, mute } = req.body;
  if (!userId || !channelId || typeof mute !== 'boolean') {
    return res.status(400).json({ error: "userId, channelId 及 mute(boolean) 為必填" });
  }
  try {
    const op = mute
      ? { $addToSet: { mutedChannels: channelId } }
      : { $pull:    { mutedChannels: channelId } };
    const doc = await AdminChannel.findOneAndUpdate(
      { userId },
      op,
      { new: true, upsert: true }
    );
    return res.json({ success: true, mutedChannels: doc.mutedChannels });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// API endpoint to check if a channel is muted. (Protected)
app.get("/api/channel-mute", authenticateToken, async (req, res) => {
  const { userId } = req.user;  // 由 authenticateToken 提供
  const { channelId } = req.query;
  if (!channelId) {
    return res.status(400).json({ error: "channelId is required" });
  }
  const doc = await AdminChannel.findOne({ userId });
  const muted = doc?.mutedChannels.includes(channelId) ?? false;
  return res.json({ muted });
});




// POST /api/send-message endpoint. (Protected)
/**
 * POST /api/send-message endpoint.
 * Accepts a message payload, fills missing fields,
 * then broadcasts the message to the corresponding room and sends push notifications.
 */
app.post("/api/send-message", authenticateToken, async (req, res) => {
  let { message } = req.body;
  if ((!message.text || message.text.trim() === "") && !message.image) {
    if (typeof message === "string") {
      message = { text: message };
    } else {
      return res.status(400).json({ error: 'Missing message content. Provide text or image.' });
    }
  }

  const finalMessage = {
    text: message.text || "", // Default to empty string if text is missing
    user: {
      _id: (message.user && message.user._id) ? message.user._id : `user_${Math.random().toString(36).substring(7)}`,
    },
    channelId: message.channelId,
    createdAt: message.createdAt || new Date().toISOString(),
    _id: message._id || uuidv4(),
    image: message.image // Will be undefined if not provided
  };
  //console.log(finalMessage);

  // Save the message to MongoDB
  try {
    await Message.create(finalMessage);
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
    if (doc.mutedChannels.includes(channelId)) return;
    doc.pushTokens.forEach(token => {
      if (!Expo.isExpoPushToken(token)) {
        console.error(`Push token ${token} is not a valid Expo push token`);
        return;
      }
      messagesToSend.push({
        to: token,
        sound: "default",
        title: "SurveyMax",
        body: finalMessage.text ? finalMessage.text : "You received an image",
        data: { message: finalMessage, url: "surveyMax://chatroom?id="+message.channelId },
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

// NEW: API endpoint to handle general data submissions (e.g., surveys). (public)
app.post("/api/send-data", async (req, res) => {
  const payload = req.body;
  if (!payload._type) {
    return res.status(400).json({ error: "_type field is required." });
  }

  // We may server as a proxy to forward the data to third party server, e.g. the http server that does not accept https
  if (payload._forwardingUrl && payload._forwardingData){
    request.post(
      {
        url: payload._forwardingUrl,
        json: payload._forwardingData, // Automatically stringifies the JSON and sets the Content-Type header
        headers: {
          "Content-Type": "application/json",
        },
      },
      (error, response, body) => {
        if (error) {
          console.error("Error forwarding data:", error.message);
          return;
        }
        console.log("Forwarded data response:", body);
      }
    );        
    // no need for forwawrding data any further
    delete payload._forwardingUrl;
    delete payload._forwardingData;
  }

  if (payload._type === 'survey') {
    const survey = await SurveySchema.findOne({ _id: payload._typeId });
    if (!survey) {
      return res.status(400).json({ error: "Invalid survey id." });
    }
  }

  // Always generate a new unique _id for the document.
  payload._id = uuidv4();

  try {
    const newData = new GeneralData(payload);
    await newData.save();
    //console.log(`Saved ${payload._type} data with id ${payload._id}`);

    // If _typeId is provided, also send a message to that channel.
    // console.log(payload);
    if (payload._channelId) {

        // test whether we should send notification
      if (payload._type === 'survey') {
        const survey = await SurveySchema.findById(payload._typeId);
        // console.log(survey);
        if (survey.eventTriggers?.length > 0) {
          for (const trigger of survey.eventTriggers) {
            const vm = new VM({
                timeout: 1000,
				console: "inherit", // 讓 sandbox 裡的 console.log 可以印到終端
                sandbox: {
					console: console,
                    surveyData: payload,
                    /**
                    * fetchHistoricalData(startTime, endTime):
                    *   - startTime: a Date‐parsable value (ms since epoch or ISO string)
                    *   - endTime:   a Date‐parsable value
                    *
                    * If you only want “since X” you can pass endTime = null or omit it.
                    */
                    fetchHistoricalData: async(startTime, endTime) => {
                        // always filter by _typeId first:
                        const query = {
                            _typeId: payload._typeId
                        };

                        // if a startTime is provided, ensure createdAt ≥ startTime
                        if (startTime) {
                            query.createdAt = query.createdAt || {};
                            query.createdAt.$gte = new Date(startTime);
                        }

                        // if an endTime is provided, ensure createdAt ≤ endTime
                        if (endTime) {
                            query.createdAt = query.createdAt || {};
                            query.createdAt.$lte = new Date(endTime);
                        }
						console.log("GeneralData.find", query);
                        return GeneralData.find(query);
                    }
                }
            });
            
            try {
			  //console.log("===",trigger.script,"---");
              const checkCondition = vm.run(trigger.script);
              //console.log('****', payload);
              const result = await checkCondition(payload);
              if (result) {
                // Trigger your event handling here
                console.log('Event triggered:', result);
                const message = {
                  text: result,
                  user: { _id: "system" },
                  channelId: payload._channelId,
                  createdAt: new Date().toISOString(),
                  _id: uuidv4(),
                };

                sendAndNotify(null, message.channelId, message);
              }
            } catch (err) {
              console.error('Error executing trigger:', err);
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true, data: newData });
  } catch (err) {
    console.error("Error saving general data:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// NEW: API endpoint to read general data. (Protected)
// API endpoint to read general data based on _channelId, _storeId, and _type
app.get("/api/read-data", authenticateToken, async (req, res) => {
  const { _typeId, _storeId, _type } = req.query;

  // Ensure at least one filter parameter is provided
  if (!_type && !_typeId) {
    return res.status(400).json({ error: "At least one filter parameter is required." });
  }

  try {
    // Build the query object dynamically based on provided parameters
    let query = {};
    if (_typeId) query._typeId = _typeId;
    if (_storeId) query._storeId = _storeId;
    if (_type) query._type = _type;

    // Fetch matching records from MongoDB
    const results = await GeneralData.find(query);

    if (results.length === 0) {
      return res.status(200).json({ message: "No matching data found.", data: [] });
    }

    console.log(`Fetched ${results.length} records`);
    const dataArray = results.map(item => item.data);
    return res.status(200).json({ success: true, data: dataArray });

  } catch (err) {
    console.error("Error fetching general data:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// DELETE: Remove a user account by userId. (Protected)
app.delete("/api/user/:userId", authenticateToken, async (req, res) => {
  const { userId } = req.params;
  try {
    // Remove user from the users collection
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found." });
    }

    // Also remove from AdminChannel collection if present
    await AdminChannel.findOneAndDelete({ userId });

    console.log(`Deleted user: ${deletedUser.email} (ID: ${userId})`);
    return res.status(200).json({ message: "User account deleted successfully." });
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// DELETE: Remove a survey schema by ID. (Protected)
app.delete("/api/survey/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const deletedSurvey = await SurveySchema.findByIdAndDelete(id);
    if (!deletedSurvey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    console.log(`Deleted survey: ${id}`);
    return res.status(200).json({ message: "Survey schema deleted successfully." });
  } catch (err) {
    console.error("Error deleting survey:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ***** Survey operations *****
// GET a specific survey schema by id. (public)
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

// GET list of surveys filtered by userId (optional). (Protected)
app.get("/api/survey", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.query;
    let query = {};
    if (userId) query._userId = userId;
    else return res.json({error:'userId not assigned'});
    const surveys = await SurveySchema.find(query);
    return res.json(surveys);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST to create a new survey schema. (Protected)
app.post("/api/survey", authenticateToken, async (req, res) => {
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

// PUT to update an existing survey schema. (Protected)
app.put("/api/survey/:id", authenticateToken, async (req, res) => {
  try {
    const updatedSurvey = await SurveySchema.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedSurvey) return res.status(404).json({ error: "Survey not found" });
    return res.json(updatedSurvey);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH to increment a counter in the survey schema. (public)
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

// POST to add an event trigger to a survey. (Protected)
app.post("/api/survey/:id/triggers", authenticateToken, async (req, res) => {
  try {
    const survey = await SurveySchema.findByIdAndUpdate(
      req.params.id,
      { $push: { eventTriggers: req.body } },
      { new: true }
    );
    res.json(survey.eventTriggers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET to retrieve triggers for a survey. (Public)
app.get("/api/survey/:id/triggers", async (req, res) => {
  try {
    const survey = await SurveySchema.findById(req.params.id);
    res.json(survey.eventTriggers || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT to modify an event trigger in a survey. (Protected)
app.put("/api/survey/:surveyId/triggers/:triggerId", authenticateToken, async (req, res) => {
  try {
    // Find the survey with the specified surveyId and a trigger with the triggerId
    const survey = await SurveySchema.findOneAndUpdate(
      { _id: req.params.surveyId, "eventTriggers._id": req.params.triggerId },
      { $set: { "eventTriggers.$": req.body } },
      { new: true }
    );
    if (!survey) {
      return res.status(404).json({ error: "Survey or trigger not found" });
    }
    res.json(survey.eventTriggers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.delete("/api/survey/:surveyId/triggers/:triggerId", authenticateToken, async (req, res) => {
  try {
    const survey = await SurveySchema.findOneAndUpdate(
      { _id: req.params.surveyId },
      { $pull: { eventTriggers: { _id: req.params.triggerId } } },
      { new: true }
    );
    if (!survey) {
      return res.status(404).json({ error: "Survey or trigger not found" });
    }
    res.json({ success: true, eventTriggers: survey.eventTriggers });
  } catch (err) {
    console.error("Error deleting trigger:", err);
    res.status(500).json({ error: err.message });
  }
});


/************************************* 
* AWS S3 operations 
* Endpoint to generate a presigned URL for PUT (upload)
*************************************/
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

/********************************************
 * LLM server
 *******************************************/

// Initialize OpenAI with your API key
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

// REST API endpoint to generate a survey schema. (Protected)
app.post('/api/generateSurveySchema', authenticateToken, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    // Define a system instruction that explains how to structure the survey JSON.
    const systemInstruction = `
#### Survey_Schema JSON
{
  "surveyTitle": "string",            // The title of the survey.
  "storeTitle": "string",             // The title of the store.
  "storeId": "string or number",      // The ID of the store.
  "endpointUrl": "string",            // URL to submit or retrieve survey data.
  "surveyItems": [                    // An ordered list of items in the survey.
    {
      "type": "question",             // Item type: "question"
      "id": "number",                 // A unique ID for this question (usually generated via Date.now())
      "questionText": "string",       // The text/content of the question.
      "questionType": "text | radio | checkbox | date | longtext | stars",
                                      // The type of the question:
                                      // - "text": Single-line text input.
                                      // - "radio": Single-select multiple choice.
                                      // - "checkbox": Multi-select multiple choice.
                                      // - "date": Date picker.
                                      // - "longtext": Multi-line text input.
                                      // - "stars": Star rating input.
      "required": "boolean",          // Indicates if this question must be answered.
      "compack": "boolean",           // (Optional) For radio/checkbox types to show compact style.
      "options": [                    // (Optional) For radio/checkbox questions.
        "string", "string", "..."
      ],
      "maxStars": "number"            // (Optional) Only for "stars" type questions; maximum number of stars.
    },
    {
      "type": "group",                // Item type: "group"
      "id": "number",                 // A unique ID for this group.
      "groupTitle": "string",         // The title of the group.
      "anchorQuestionId": "number or null",
                                      // (Optional) The ID of the question that controls the visibility of this group.
      "anchorValuesToShow": [         // (Optional) Array of answer values that, when selected in the anchor question, show this group.
        "string", "string", "..."
      ],
      "subQuestions": [               // An array of sub-questions within this group.
        {
          "type": "question",         // Sub-question follows the same structure as a main question.
          "id": "number",
          "questionText": "string",
          "questionType": "text | radio | checkbox | date | longtext | stars",
          "required": "boolean",
          "compack": "boolean",
          "options": [
            "string", "string", "..."
          ],
          "maxStars": "number"
        }
        // ... more sub-questions can be added here.
      ]
    }
    // ... more survey items (questions or groups) can be added here.
  ]
}


####
base on above JSON definition, please generate a survey for user's request, and please generate the survey in the language that user is using.
the system should analysis user's request first, then generate a deep and useful survey schema. When responding, please format your output strictly as JSON without additional commentary.
    `;

    // Create a prompt that combines the system instruction and the user description.
    const userPrompt = `${description}`;

    // Call OpenAI’s Chat Completion endpoint
    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini-2024-07-18", // or another available model
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const generatedText = completion.data.choices[0].message.content.trim();

    // Optionally, attempt to parse the generated text as JSON.
    let generatedSchema;
    try {
      generatedSchema = JSON.parse(generatedText);
    } catch (parseError) {
      // If parsing fails, send the raw text.
      generatedSchema = generatedText;
    }

    res.json({ schema: generatedSchema });
  } catch (error) {
    console.error("Error generating survey schema:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server.
server.listen(5300, () => {
  console.log("Server running on http://localhost:5300");
});

// ----------------------------------------
// Helper function used in message and survey data endpoints.
async function sendAndNotify(socket, channelId, message){
  // Save the message to MongoDB
  try {
    await Message.create(message)
    console.log(`Stored message in channel ${channelId}:`, message);
  } catch (err) {
    console.error("Error saving message:", err);
  }

  // Broadcast the message only to the room (excluding sender)
  if (socket)
    socket.to(channelId).emit("receiveMessage", message);
  else 
    io.to(channelId).emit("receiveMessage", message);
  console.log(`Broadcast message to room ${channelId}`);

  // Prepare remote push notifications for registered devices (if needed)
  const adminDocs = await AdminChannel.find({ channels: channelId });
  const messagesToSend = [];
  adminDocs.forEach(doc => {
    // Skip sending a push notification to the sender.
    if (doc.userId === message.user._id) return;
    if (doc.mutedChannels.includes(channelId)) return;
    // Iterate over each push token for the user.
    doc.pushTokens.forEach(token => {
      if (!Expo.isExpoPushToken(token)) {
        console.error(`Push token ${token} is not a valid Expo push token`);
        return;
      }
      messagesToSend.push({
        to: token,
        sound: "default",
        title: "SurveyMax",
        body: message.text ? message.text : "You received an image or document",
        data: { message, url: "surveyMax://chatroom?id=" + channelId },
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
}