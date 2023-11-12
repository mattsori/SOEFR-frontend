const fs = require("fs");
const https = require("https");
const path = require("path");

const axios = require("axios");
const express = require("express");
const Queue = require("better-queue");
const WebSocket = require("ws");
const wav = require("wav");

const app = express();

// Load SSL certificates
const privateKey = fs.readFileSync("cloudflare-key.pem", "utf8");
const certificate = fs.readFileSync("cloudflare-cert.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };

// Create an HTTPS server
const httpsServer = https.createServer(credentials, app);

// Serve static files (e.g., HTML, CSS, JavaScript)
app.use(express.static(path.join(__dirname, "public")));

// WebSocket handling
const wss = new WebSocket.Server({ server: httpsServer });

// Audio Constants
const sampleRate = 48000; // Sample rate of the audio
const overlapDurationMs = 300; // Define the overlap duration in milliseconds
const bytesPerSample = 2; // Assuming 16-bit audio (2 bytes per sample)
const overlapSize = (sampleRate * bytesPerSample * overlapDurationMs) / 1000; // Calculate the size of the overlap in bytes
const longChunkAmount = 5; // How many chunks to be received before saving a longer duration audio file

// Ensure 'recordings' directory exists
const recordingsDir = path.join(__dirname, "recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

wss.on("connection", (ws) => {
  console.log("WebSocket connection established");
  ws.sequence = 0;
  let counter = 0; // Counter for transcription segments
  let combinedChunks = Buffer.alloc(0); // Buffer to hold combined chunks
  let previousAudioBuffer = Buffer.alloc(0); // Initialize an empty buffer for each connection

  ws.on("message", async (message) => {
    try {
      if (typeof message === "object" && message instanceof Buffer) {
        // Increment the counter here
        counter++;
        combinedChunks = Buffer.concat([combinedChunks, message]);
        // Prepend the previous buffer (overlap) to the current message
        const combinedMessage = Buffer.concat([previousAudioBuffer, message]);

        const filename = `audio_${Date.now()}_${counter}.wav`;
        const filePath = path.join(__dirname, "recordings", filename);

        await writeWavFile(filePath, combinedMessage);
        console.log(`${filename} saved.`);

        // Update the previous buffer with the last part of the current message
        previousAudioBuffer = message.slice(-overlapSize);

        // This will handle the transcription of individual audio files
        transcriptionQueue.push({ filePath, ws, size: "short" });

        // Check if it's time to save the combined chunks
        if (counter % longChunkAmount === 0) {
          const longFilename = `combined_audio_${Date.now()}.wav`;
          const longFilePath = path.join(__dirname, "recordings", longFilename);

          await writeWavFile(longFilePath, combinedChunks);
          console.log(`${longFilename} saved.`);

          // Reset the combined chunks buffer
          combinedChunks = Buffer.alloc(0);

          // Transcribe and send the transcription of the combined audio
          // transcriptionQueue.push({
          //   filePath: longFilePath,
          //   ws,
          //   size: "long",
          // });
          await transcribeAndSend(longFilePath, ws, "long");
        }
      } else {
        console.log(JSON.parse(message));
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    // Clear the overlap buffer for this connection
    previousAudioBuffer = null;
  });
});

// Define a job queue
let transcriptionQueue = new Queue(
  async (job, done) => {
    try {
      const { filePath, ws, size } = job;
      await transcribeAndSend(filePath, ws, size);
      done();
    } catch (error) {
      console.error(`Error in job queue: ${error}`);
      done(error);
    }
  },
  { concurrent: 1 }
); // Ensure only one job is processed at a time

// Sending to transcription server
async function transcribeAndSend(filePath, ws, size) {
  try {
    let transcribeEndpoint;
    if (size == "short") {
      transcribeEndpoint = "http://localhost:8001/transcribeshort";
    } else {
      transcribeEndpoint = "http://localhost:8002/transcribelong";
    }

    const response = await axios.post(transcribeEndpoint, {
      audio_file_path: filePath,
      audio_size: size,
    });

    const transcript = response.data.transcription;
    console.log(transcript);
    // Increment the sequence for each message sent
    ws.sequence += 1;

    // Send the transcript along with the sequence code
    ws.send(
      JSON.stringify({
        transcript,
        sequence: ws.sequence,
        audio_size: size,
      })
    );
  } catch (error) {
    console.error(`Error in transcription API call: ${error}`);
    // Send the error along with the current sequence number
    ws.send(
      JSON.stringify({
        error: "Error during transcription",
        details: error.toString(),
        sequence: ws.sequence,
      })
    );
  }
}

// Promisified writing files
function writeWavFile(filePath, message) {
  return new Promise((resolve, reject) => {
    const fileWriter = new wav.FileWriter(filePath, {
      channels: 1,
      sampleRate: sampleRate,
      bitDepth: 16,
    });

    fileWriter.on("error", reject);
    fileWriter.on("finish", resolve);

    fileWriter.write(message);
    fileWriter.end();
  });
}

httpsServer.listen(443, () => {
  console.log("Server is running on port 443");
});
