// DOM element references
const connectionBtn = document.getElementById("connectionBtn");
const transciptBox = document.getElementById("transcriptBox");
const summarizeBtn = document.getElementById("summarizeBtn");
const microphoneBtn = document.getElementById("microphoneBtn");

// WebSocket and audio variables
let ws;
let isRecording = false;
let accumulatedSamples = [];
let audioContext;
let sampleRate;
let chunkSamples;
const chunkDuration = 3; // duration of audio chunks in seconds
let source;
let workletNode;
let stream;

// Transcription variables
let fullTranscription = ""; // Full transcription text

// Toast messages for status notifications
function showToast(message) {
  const toastContainer = document.getElementById("toast-container");
  const toastMsg = document.createElement("div");
  toastMsg.classList.add("toast-message");
  toastMsg.textContent = message;

  // Add the toast message to the container
  toastContainer.appendChild(toastMsg);

  // Show the toast message
  setTimeout(() => {
    toastMsg.classList.add("show");
  }, 100);

  // After some time, hide and remove the toast message
  setTimeout(() => {
    toastMsg.classList.remove("show");
    setTimeout(() => {
      toastContainer.removeChild(toastMsg);
    }, 500);
  }, 3000); // Will stay for 3 seconds
}

// Establish or terminate a WebSocket connection when the button is clicked
connectionBtn.addEventListener("click", () => {
  toggleWebSocketConnection();
});

// Start or stop audio recording when the microphone button is clicked
microphoneBtn.addEventListener("click", async () => {
  toggleMicrophone();
});

// DOM element reference for the clear button
const clearBtn = document.getElementById("clearBtn");

// Event listener for the 'click' event of the clear button
clearBtn.addEventListener("click", () => {
  transciptBox.value = ""; // Clears the first text box
  // If you also want to clear the second text box when the clear button is clicked, uncomment the following line:
  // document.getElementById('summaryBox').value = '';
});

// Event listener for the 'Summarize' button
summarizeBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "summarize", text: fullTranscription }));
  } else {
    showToast("WebSocket is not connected.");
  }
});

/**
 * Toggles the WebSocket connection. Connects if currently disconnected,
 * otherwise disconnects.
 */
function toggleWebSocketConnection() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("Closing WebSocket connection...");
    ws.close();
  } else {
    console.log("Initializing WebSocket connection...");
    initializeWebSocket();
  }
}

/**
 * Initializes the WebSocket connection and sets up event handlers.
 */
function initializeWebSocket() {
  ws = new WebSocket("wss://soefr.com:2096");
  ws.binaryType = "arraybuffer";

  console.log("WebSocket initialized, setting up event handlers.");

  // Event handlers for WebSocket events
  ws.onopen = handleWebSocketOpen;
  ws.onclose = handleWebSocketClose;
  ws.onerror = handleWebSocketError;
  ws.onmessage = handleWebSocketMessage;
}

// Handles the 'open' event for WebSocket
function handleWebSocketOpen() {
  console.log("WebSocket connection opened.");
  updateConnectionStatus(true);
}

// Handles the 'close' event for WebSocket
function handleWebSocketClose() {
  console.log("WebSocket connection closed.");
  updateConnectionStatus(false);

  // Check if recording is ongoing and stop it
  if (isRecording) {
    stopRecording();
  }
}

// Handles the 'error' event for WebSocket
function handleWebSocketError(error) {
  console.error("WebSocket encountered an error: ", error);
  showToast("WebSocket encountered an error");
}

// Processes messages received through WebSocket
function handleWebSocketMessage(message) {
  const data = JSON.parse(message.data);

  // Handle transcripts
  if (data.hasOwnProperty("transcript")) {
    console.log("Transcript Received");
    processTranscript(data.transcript, data.audio_size);
  }

  // Handle summaries
  if (data.hasOwnProperty("summary")) {
    console.log("Summary Received");
    document.getElementById("summaryBox").value = data.summary;
  }

  // Handle errors
  if (data.hasOwnProperty("error")) {
    console.error("WebSocket Error:", data.error);
    showToast("WebSocket Error");
  }
}

/**
 * Updates the UI and internal variables based on the connection status.
 * @param {boolean} isConnected - Whether the WebSocket is connected.
 */
function updateConnectionStatus(isConnected) {
  if (isConnected) {
    showToast("Connected to WebSocket server.");
    connectionBtn.textContent = "Disconnect";
    connectionBtn.classList.replace("blue", "red");
    microphoneBtn.disabled = false;
  } else {
    showToast("Disconnected from WebSocket server.");
    connectionBtn.textContent = "Connect";
    connectionBtn.classList.replace("red", "blue");
    microphoneBtn.disabled = true;
  }
}

/**
 * Toggles the microphone usage: starts or stops audio recording.
 */
async function toggleMicrophone() {
  if (!isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
}

/**
 * Starts audio recording by accessing the microphone and processing audio chunks.
 */
async function startRecording() {
  try {
    console.log("Starting recording...");
    isRecording = true;
    if (!audioContext) {
      initializeAudioContext();
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone access granted.");
    source = audioContext.createMediaStreamSource(stream);
    await addAudioProcessor();
    microphoneBtn.textContent = "🛑"; // Change the mic icon to a stop icon
  } catch (error) {
    console.error("Error accessing microphone:", error);
    showToast("Error accessing microphone");
  }
}

/**
 * Initializes the AudioContext and related properties
 * AudioContext handles the creation, processing, and decoding of audio data
 * and is specifically for web browsers.
 */
function initializeAudioContext() {
  audioContext = new AudioContext();
  sampleRate = audioContext.sampleRate;
  chunkSamples = chunkDuration * sampleRate; // Number of samples in each audio chunk
}

// Adds the audio worklet module and connects nodes
async function addAudioProcessor() {
  console.log("Adding audio processor...");
  await audioContext.audioWorklet.addModule("audio-processor.js");
  workletNode = new AudioWorkletNode(audioContext, "audio-stream-processor");
  source.connect(workletNode);
  workletNode.connect(audioContext.destination);
  workletNode.port.onmessage = handleAudioProcess;
  console.log("Audio processor added and connected.");
}

// Handles the processing of audio chunks
function handleAudioProcess(event) {
  accumulatedSamples = accumulatedSamples.concat(Array.from(event.data));
  if (accumulatedSamples.length >= chunkSamples) {
    const chunk = accumulatedSamples.splice(0, chunkSamples);
    sendAudioChunk(chunk);
  }
}

// Stops the audio recording and releases the microphone
function stopRecording() {
  console.log("Stopping recording...");
  isRecording = false;
  if (stream) {
    stream.getTracks().forEach((track) => {
      console.log("Stopping track:", track);
      track.stop();
    });
  }
  if (workletNode && source) {
    source.disconnect(workletNode);
    workletNode.disconnect(audioContext.destination);
  }
  microphoneBtn.textContent = "🎙️"; // Restore the mic icon
}

/**
 * Converts a Float32Array of audio samples to Int16Array and sends it over WebSocket.
 * @param {Float32Array} chunk - The audio samples to send.
 */
function sendAudioChunk(chunk) {
  const int16Array = float32ArrayToInt16Array(chunk);
  ws.send(int16Array.buffer);
}

/**
 * Converts Float32Array to Int16Array, clamping values as necessary.
 * @param {Float32Array} float32Array - Array of audio samples as floats.
 * @returns {Int16Array}
 */
function float32ArrayToInt16Array(float32Array) {
  return Int16Array.from(
    float32Array.map((n) => Math.max(-1, Math.min(1, n)) * 0x7fff)
  );
}

/**
 * Processes and displays the transcript received from the server.
 * @param {string} transcript - The transcript text.
 * @param {string} audio_size - Flag indicating size of transcript.
 */
function processTranscript(transcript, audio_size) {
  console.log("Processing " + audio_size + " transcript:", transcript);
  const trimmedTranscript = transcript.trim();

  if (audio_size == "long") {
    // Add a space only if fullTranscription is not empty
    fullTranscription += fullTranscription
      ? ` ${trimmedTranscript}`
      : trimmedTranscript;
    transciptBox.value = fullTranscription;
  } else {
    // Add a space only if the current value in transciptBox is not empty
    transciptBox.value += transciptBox.value
      ? ` ${trimmedTranscript}`
      : trimmedTranscript;
  }
}
