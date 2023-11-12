class AudioStreamProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        // If there's an input channel.
        if (input.length > 0) {
            // Sending audio data to the main thread. Note that this operation can be costly.
            this.port.postMessage(input[0]);
        }
        return true;
    }
}

registerProcessor('audio-stream-processor', AudioStreamProcessor);