// Usage:
//   1) npm install node-fetch uuid
//   2) node sendMessage.js "Hello from Node" "myUserId123"
//
// This script will POST a GiftedChat-format message to the API server at /api/send-message.
//
// If userId is not provided, a random user ID will be generated.
// The message _id is generated via uuid.

const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

// Grab command-line arguments
const text = process.argv[2];
let userId = process.argv[3] || 'system';

if (!text) {
  console.error('Error: Please provide a text argument.\nExample usage: node sendMessage.js "Hello world"');
  process.exit(1);
}

// If userId wasn't provided, generate a random one
if (!userId) {
  userId = Math.random().toString(36).substring(7);
}

const SERVER_URL = 'http://localhost:3000/api/send-message';

async function postMessage(textMsg, uid) {
  // Construct the message object in GiftedChat format
  let messageObj = {
    text: textMsg,
    user: { _id: uid },
//    createdAt: new Date().toISOString(),
//    _id: uuidv4(),
  };

messageObj = textMsg;


  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: messageObj }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    const data = await response.json();
    console.log('Message sent successfully:', data);
  } catch (error) {
    console.error('Error sending message:', error.message);
  }
}

postMessage(text, userId);
