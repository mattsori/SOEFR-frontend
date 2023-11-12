const fs = require("fs");
const https = require("https");
const express = require("express");
const path = require("path");

const app = express();

// Load SSL certificates
const privateKey = fs.readFileSync("cloudflare-key.pem", "utf8");
const certificate = fs.readFileSync("cloudflare-cert.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };

// Create an HTTPS server
const httpsServer = https.createServer(credentials, app);

// Serve static files (e.g., HTML, CSS, JavaScript)
app.use(express.static(path.join(__dirname, "public")));

httpsServer.listen(443, () => {
  console.log("Server is running on port 443");
});
