const axios = require("axios");
const { program } = require("commander");
require("dotenv").config(); // Load environment variables

// Set default server URL (modify if needed)
const BASE_URL = process.env.SERVER_URL || "http://b200.tagfans.com:5300";

// Setup CLI arguments
program
  .option("-c, --channelId <channelId>", "Filter by _channelId")
  .option("-s, --storeId <storeId>", "Filter by _storeId")
  .option("-t, --type <type>", "Filter by _type")
  .parse(process.argv);

const options = program.opts();

// Ensure at least one filter parameter is provided
if (!options.channelId && !options.storeId && !options.type) {
  console.error("Error: Please provide at least one filter parameter (-c, -s, -t).");
  process.exit(1);
}

// Build query parameters dynamically
const queryParams = new URLSearchParams();
if (options.channelId) queryParams.append("_channelId", options.channelId);
if (options.storeId) queryParams.append("_storeId", options.storeId);
if (options.type) queryParams.append("_type", options.type);

// Construct full API URL
const apiUrl = `${BASE_URL}/api/read-data?${queryParams.toString()}`;

async function fetchData() {
  try {
    console.log(`Fetching data from: ${apiUrl}`);

    // Make API request
    const response = await axios.get(apiUrl);

    if (response.data.success) {
      console.log("Fetched data:", JSON.stringify(response.data.data, null, 2));
    } else {
      console.log("No matching data found.");
    }
  } catch (error) {
    console.error("Error fetching data:", error.response ? error.response.data : error.message);
    process.exit(1);
  }
}

// Execute function
fetchData();
