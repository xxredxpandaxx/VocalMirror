const startButton = document.querySelector("#start-button");
const startLabel = document.querySelector("#start-label");
const muteButton = document.querySelector("#mute-button");
const delaySlider = document.querySelector("#delay-slider");
const volumeSlider = document.querySelector("#volume-slider");
const delayReadout = document.querySelector("#delay-readout");
const levelReadout = document.querySelector("#level-readout");
const pitchReadout = document.querySelector("#pitch-readout");
const pitchNote = document.querySelector("#pitch-note");
const statusPill = document.querySelector("#status-pill");
const statusText = document.querySelector("#status-text");
const waveform = document.querySelector("#waveform");
const waveformContext = waveform.getContext("2d");

const state = {
  audioContext: null,
  analyser: null,
  delayNode: null,
  outputGain: null,
  stream: null,
  source: null,
  muted: false,
  running: false,
  animationFrame: null,
  phase: 0,
  lastPitch: null,
  pitchFrame: 0
};

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function setStatus(text, mode = "idle") {
  statusText.textContent = text;
  statusPill.classList.toggle("live", mode === "live");
  statusPill.classList.toggle("error", mode === "error");
}

function setDelay(ms) {
  delaySlider.value = ms;
  delayReadout.textContent = `${ms} ms`;

  if (state.delayNode && state.audioContext) {
    state.delayNode.delayTime.setTargetAtTime(ms / 1000, state.audioContext.currentTime, 0.025);
  }

  document.querySelectorAll("[data-delay]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.delay) === Number(ms));
  });
}

function setVolume(percent) {
  volumeSlider.value = percent;
  if (state.outputGain && state.audioContext) {
    const gain = state.muted ? 0 : Number(percent) / 100;
    state.outputGain.gain.setTargetAtTime(gain, state.audioContext.currentTime, 0.02);
  }
}

function pitchToNote(frequency) {
  const noteNumber = Math.round(12 * Math.log2(frequency / 440) + 69);
  const octave = Math.floor(noteNumber / 12) - 1;
  return `${noteNames[noteNumber % 12]}${octave}`;
}

function detectPitch(samples, sampleRate) {
  let rms = 0;

  for (let index = 0; index < samples.length; index += 1) {
    rms += samples[index] * samples[index];
  }

  rms = Math.sqrt(rms / samples.length);
  if (rms < 0.015) return null;

  const minLag = Math.floor(sampleRate / 1100);
  const maxLag = Math.min(Math.floor(sampleRate / 60), samples.length - 1);
  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;

    for (let index = 0; index < samples.length - lag; index += 1) {
      correlation += samples[index] * samples[index + lag];
    }

    correlation /= samples.length - lag;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation < 0.002) return null;

  const frequency = sampleRate / bestLag;
  if (frequency < 60 || frequency > 1100) return null;

  return frequency;
}

function updatePitch(samples) {
  state.pitchFrame = (state.pitchFrame + 1) % 3;
  if (state.pitchFrame !== 0) return;

  const pitch = detectPitch(samples, state.audioContext.sampleRate);

  if (!pitch) {
    state.lastPitch = null;
    pitchReadout.textContent = "-- Hz";
    pitchNote.textContent = "--";
    return;
  }

  const smoothedPitch = state.lastPitch ? (state.lastPitch * 0.72) + (pitch * 0.28) : pitch;
  state.lastPitch = smoothedPitch;
  pitchReadout.textContent = `${Math.round(smoothedPitch)} Hz`;
  pitchNote.textContent = pitchToNote(smoothedPitch);
}

async function startMonitoring() {
  try {
    const audioContext = new AudioContext();
    await audioContext.resume();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const delayNode = audioContext.createDelay(3);
    const outputGain = audioContext.createGain();

    analyser.fftSize = 2048;
    delayNode.delayTime.value = Number(delaySlider.value) / 1000;
    outputGain.gain.value = Number(volumeSlider.value) / 100;

    source.connect(analyser);
    source.connect(delayNode);
    delayNode.connect(outputGain);
    outputGain.connect(audioContext.destination);

    if (state.animationFrame) {
      cancelAnimationFrame(state.animationFrame);
    }

    Object.assign(state, {
      audioContext,
      analyser,
      delayNode,
      outputGain,
      stream,
      source,
      running: true,
      muted: false,
      animationFrame: null,
      lastPitch: null,
      pitchFrame: 0
    });

    startButton.classList.add("active");
    startLabel.textContent = "Stop monitor";
    muteButton.disabled = false;
    muteButton.textContent = "Output on";
    setStatus("Live", "live");
    draw();
  } catch (error) {
    setStatus("Mic blocked", "error");
    console.error(error);
  }
}

function stopMonitoring() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }

  if (state.audioContext) {
    state.audioContext.close();
  }

  Object.assign(state, {
    audioContext: null,
    analyser: null,
    delayNode: null,
    outputGain: null,
    stream: null,
    source: null,
    running: false,
    animationFrame: null,
    lastPitch: null,
    pitchFrame: 0
  });

  startButton.classList.remove("active");
  startLabel.textContent = "Start monitor";
  muteButton.disabled = true;
  muteButton.textContent = "Output on";
  setStatus("Idle");
  drawIdle();
}

function drawBackground(width, height) {
  const gradient = waveformContext.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(77, 215, 199, 0.2)");
  gradient.addColorStop(0.45, "rgba(183, 164, 255, 0.16)");
  gradient.addColorStop(1, "rgba(255, 138, 114, 0.2)");
  waveformContext.fillStyle = gradient;
  waveformContext.fillRect(0, 0, width, height);
}

function drawIdleFrame() {
  const rect = waveform.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  waveform.width = Math.max(1, Math.floor(rect.width * scale));
  waveform.height = Math.max(1, Math.floor(rect.height * scale));
  waveformContext.setTransform(scale, 0, 0, scale, 0, 0);

  drawBackground(rect.width, rect.height);
  waveformContext.lineWidth = 3;
  waveformContext.strokeStyle = "rgba(247, 244, 239, 0.62)";
  waveformContext.beginPath();

  for (let x = 0; x < rect.width; x += 7) {
    const y = rect.height / 2 + Math.sin((x * 0.025) + state.phase) * 18;
    if (x === 0) {
      waveformContext.moveTo(x, y);
    } else {
      waveformContext.lineTo(x, y);
    }
  }

  waveformContext.stroke();
  state.phase += 0.015;
  levelReadout.textContent = "0%";
  pitchReadout.textContent = "-- Hz";
  pitchNote.textContent = "--";
}

function drawIdle() {
  if (state.running) return;
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
  }

  drawIdleFrame();
  state.animationFrame = requestAnimationFrame(drawIdleLoop);
}

function drawIdleLoop() {
  state.animationFrame = null;
  if (state.running) return;

  drawIdleFrame();

  if (!state.running) {
    state.animationFrame = requestAnimationFrame(drawIdleLoop);
  }
}

function draw() {
  if (!state.analyser) return;

  const rect = waveform.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  waveform.width = Math.max(1, Math.floor(rect.width * scale));
  waveform.height = Math.max(1, Math.floor(rect.height * scale));
  waveformContext.setTransform(scale, 0, 0, scale, 0, 0);

  const samples = new Uint8Array(state.analyser.frequencyBinCount);
  const pitchSamples = new Float32Array(state.analyser.fftSize);
  state.analyser.getByteTimeDomainData(samples);
  state.analyser.getFloatTimeDomainData(pitchSamples);
  drawBackground(rect.width, rect.height);

  waveformContext.lineWidth = 3;
  waveformContext.strokeStyle = "rgba(77, 215, 199, 0.92)";
  waveformContext.beginPath();

  let sum = 0;
  const step = rect.width / samples.length;

  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - 128;
    const y = (samples[index] / 255) * rect.height;
    const x = index * step;
    sum += centered * centered;

    if (index === 0) {
      waveformContext.moveTo(x, y);
    } else {
      waveformContext.lineTo(x, y);
    }
  }

  waveformContext.stroke();

  const rms = Math.sqrt(sum / samples.length);
  const level = Math.min(100, Math.round((rms / 64) * 100));
  levelReadout.textContent = `${level}%`;
  updatePitch(pitchSamples);

  state.animationFrame = requestAnimationFrame(draw);
}

startButton.addEventListener("click", () => {
  if (state.running) {
    stopMonitoring();
  } else {
    startMonitoring();
  }
});

muteButton.addEventListener("click", () => {
  state.muted = !state.muted;
  muteButton.textContent = state.muted ? "Output muted" : "Output on";
  setVolume(volumeSlider.value);
});

delaySlider.addEventListener("input", (event) => {
  setDelay(event.target.value);
});

volumeSlider.addEventListener("input", (event) => {
  setVolume(event.target.value);
});

document.querySelectorAll("[data-delay]").forEach((button) => {
  button.addEventListener("click", () => setDelay(button.dataset.delay));
});

window.addEventListener("resize", () => {
  if (!state.running) drawIdle();
});

if (!navigator.mediaDevices?.getUserMedia) {
  startButton.disabled = true;
  setStatus("Unsupported", "error");
} else {
  setDelay(delaySlider.value);
  setVolume(volumeSlider.value);
  drawIdle();
}
