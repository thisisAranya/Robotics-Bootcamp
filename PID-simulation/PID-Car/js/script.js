// --- DOM Elements & Global State ---
const roadCanvas = document.getElementById("roadCanvas");
const roadCtx = roadCanvas.getContext("2d");
const graphCanvas = document.getElementById("graphCanvas");
const graphCtx = graphCanvas.getContext("2d");

// Sliders, Outputs, and Data Displays
const sliders = {
  kp: document.getElementById("kpSlider"),
  ki: document.getElementById("kiSlider"),
  kd: document.getElementById("kdSlider"),
  speed: document.getElementById("speedSlider"),
  scale: document.getElementById("scaleSlider")
};
const outputs = {
  kp: document.getElementById("kpVal"),
  ki: document.getElementById("kiVal"),
  kd: document.getElementById("kdVal"),
  speed: document.getElementById("speedVal"),
  scale: document.getElementById("scaleVal")
};
const pathSelect = document.getElementById("pathSelect");
const dataDisplays = {
  error: document.getElementById('errorVal'),
  p: document.getElementById('pVal'),
  i: document.getElementById('iVal'),
  d: document.getElementById('dVal'),
  correction: document.getElementById('corrVal'),
  windup: document.getElementById('windupVal'),
  windupStatus: document.getElementById('windupStatus')
};
const buttons = {
  start: document.getElementById("startBtn"),
  pause: document.getElementById("pauseBtn"),
  reset: document.getElementById("resetBtn"),
  presetP: document.getElementById("presetP"),
  presetPI: document.getElementById("presetPI"),
  // Corrected ID to match the HTML for the PID button
  presetPID: document.getElementById("presetPID") 
};

// --- Color Palette ---
const computedStyles = getComputedStyle(document.documentElement);
const colors = {
  primary: computedStyles.getPropertyValue('--primary-color').trim(),
  green: computedStyles.getPropertyValue('--green').trim(),
  red: computedStyles.getPropertyValue('--red').trim(),
  orange: computedStyles.getPropertyValue('--orange').trim(),
  blue: computedStyles.getPropertyValue('--blue').trim(), /* Added blue from root */
  border: computedStyles.getPropertyValue('--border-color').trim(),
  surface: computedStyles.getPropertyValue('--surface-color').trim(),
  road: computedStyles.getPropertyValue('--road-color').trim(),
  text: computedStyles.getPropertyValue('--text-color').trim() /* Added text-color */
};

// --- Simulation & PID State ---
let simulationState = { isRunning: false, animationFrameId: null, lastTimestamp: 0, history: [], maxHistory: 300, firstUpdate: true };
let car = {};
// Updated initial PID values to match the new default slider values in index.html
let pid = { kp: 0.4, ki: 0.001, kd: 0.5, integral: 0, lastCarY: 0 };
let pathParams = { type: 'sine', scale: 1.0 }; // Path configuration

// --- Initialization ---
function init() {
  setCanvasSizes();
  setupEventListeners();
  updatePIDValuesFromUI();
  resetCar();
  draw();
}

function setCanvasSizes() {
  const container = document.getElementById('simulation-container');
  const containerWidth = container.offsetWidth;
  const availableHeight = window.innerHeight - container.offsetTop - 100;

  roadCanvas.width = containerWidth;
  roadCanvas.height = Math.max(250, Math.min(350, availableHeight * 0.6));

  const dataDisplayWidth = document.querySelector('.data-display').offsetWidth;
  const graphContainerWidth = document.getElementById('info-plots-container').offsetWidth;
  // Adjusted graph width calculation for better fit
  graphCanvas.width = graphContainerWidth - dataDisplayWidth - 24; // Use info-plots-container gap
  graphCanvas.height = Math.max(120, Math.min(150, availableHeight * 0.4));
}

function resetCar() {
  car = {
    x: 100,
    y: roadCanvas.height / 2 + 60,
    heading: 0,
    velocity: parseFloat(sliders.speed.value),
    width: 40,
    height: 20,
    disturbance: 0
  };

  // Proper initialization to avoid derivative spikes
  pid.integral = 0;
  pid.lastCarY = car.y; // Initialize with current position
  simulationState.history = [];
  simulationState.firstUpdate = true; // Flag to skip derivative on first update
  updateDataDisplays(0, 0, 0, 0, 0);
}

// --- Event Listeners ---
function setupEventListeners() {
  window.onresize = () => { pauseSimulation(); setCanvasSizes(); resetCar(); draw(); };

  for (const key in sliders) {
    sliders[key].oninput = () => {
      outputs[key].textContent = sliders[key].value;
      if(key === 'speed') car.velocity = parseFloat(sliders.speed.value);
      else if(key === 'scale') pathParams.scale = parseFloat(sliders.scale.value);
      else updatePIDValuesFromUI();
    };
  }

  pathSelect.onchange = () => {
    pathParams.type = pathSelect.value;
    // Reset car position when path changes
    pauseSimulation();
    resetCar();
    draw();
  };

  buttons.start.onclick = startSimulation;
  buttons.pause.onclick = pauseSimulation;
  buttons.reset.onclick = () => { pauseSimulation(); resetCar(); draw(); };
  roadCanvas.onclick = e => {
      const rect = roadCanvas.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      // Apply disturbance that pushes car away from click point
      car.disturbance = 60 * (clickY < car.y ? 1 : -1);
  };

  // Presets based on the new HTML structure
  buttons.presetP.onclick = () => setPreset(0.4, 0, 0);        // P-Only: Uses Kp=0.4 from HTML slider default
  buttons.presetPI.onclick = () => setPreset(0.4, 0.005, 0);   // PI: Kp=0.4, Ki=0.005
  buttons.presetPID.onclick = () => setPreset(0.4, 0.001, 0.5); // PID: Kp=0.4, Ki=0.001, Kd=0.5
}

function setPreset(kp, ki, kd) {
  sliders.kp.value = kp; sliders.ki.value = ki; sliders.kd.value = kd;
  outputs.kp.textContent = kp.toFixed(3);
  outputs.ki.textContent = ki.toFixed(3);
  outputs.kd.textContent = kd.toFixed(3);
  updatePIDValuesFromUI();
}

function updatePIDValuesFromUI() {
  pid.kp = parseFloat(sliders.kp.value);
  pid.ki = parseFloat(sliders.ki.value);
  pid.kd = parseFloat(sliders.kd.value);
}

// --- Simulation Loop ---
function startSimulation() {
  if (simulationState.isRunning) return;
  simulationState.isRunning = true;
  simulationState.lastTimestamp = performance.now();
  simulationState.animationFrameId = requestAnimationFrame(gameLoop);
}

function pauseSimulation() {
  simulationState.isRunning = false;
  cancelAnimationFrame(simulationState.animationFrameId);
}

function gameLoop(timestamp) {
  if (!simulationState.isRunning) return;
  const dt = (timestamp - simulationState.lastTimestamp) / 1000;
  simulationState.lastTimestamp = timestamp;

  // Better time step handling
  const clampedDt = Math.max(0.001, Math.min(dt, 0.05)); // Min 1ms, max 50ms

  update(clampedDt);
  draw();
  simulationState.animationFrameId = requestAnimationFrame(gameLoop);
}

function update(dt) {
  // If car goes off screen, reset its position
  if (car.x > roadCanvas.width + car.width) resetCar();

  const centerlineY = getLaneCenterY(car.x);
  const error = car.y - centerlineY;

  // PROPORTIONAL TERM
  const pTerm = pid.kp * error;

  // INTEGRAL TERM with anti-windup
  pid.integral += error * dt;

  // Anti-windup limits that scale with Ki gain
  const maxIntegralContribution = 100; // Maximum allowed integral contribution
  const maxIntegral = pid.ki > 0.0001 ? maxIntegralContribution / pid.ki : 1000; // Adjusted lower bound for Ki
  pid.integral = Math.max(-maxIntegral, Math.min(maxIntegral, pid.integral));

  const iTerm = pid.ki * pid.integral;

  // Derivative on measurement (not error) to prevent derivative kick
  let dTerm = 0;
  if (!simulationState.firstUpdate) {
    // Derivative of process variable (car position), not error
    const processDerivative = -(car.y - pid.lastCarY) / dt;
    dTerm = pid.kd * processDerivative;
  }
  simulationState.firstUpdate = false;
  pid.lastCarY = car.y; // Store current position for next iteration

  const correction = pTerm + iTerm + dTerm;

  // Apply external disturbance (wind)
  if (Math.abs(car.disturbance) > 0.1) {
      car.y += car.disturbance * dt;
      car.disturbance *= 0.95; // Exponential decay
  }

  // More direct steering angle mapping
  const maxSteerAngle = Math.PI / 4; // 45 degrees max
  const steeringSensitivity = 0.008; // Tunable parameter
  car.heading = Math.max(-maxSteerAngle, Math.min(maxSteerAngle, -correction * steeringSensitivity));

  // Update car position based on velocity and heading
  car.x += car.velocity * Math.cos(car.heading);
  car.y += car.velocity * Math.sin(car.heading);

  // Store history for plotting
  simulationState.history.push({ p: pTerm, i: iTerm, d: dTerm, error: error });
  // Using shift() on an array to remove the first element is fine if it doesn't get too large.
  // For very long histories, a circular buffer could be more performant, but for 300 points, this is perfectly adequate.
  if (simulationState.history.length > simulationState.maxHistory) simulationState.history.shift(); 

  // Calculate windup percentage for monitoring
  const windupPercentage = Math.abs(pid.integral / maxIntegral) * 100;

  updateDataDisplays(error, pTerm, iTerm, dTerm, correction, windupPercentage);
}

function updateDataDisplays(error, p, i, d, corr, windupPercent = 0) {
  dataDisplays.error.textContent = error.toFixed(2);
  dataDisplays.p.textContent = p.toFixed(2);
  dataDisplays.i.textContent = i.toFixed(2);
  dataDisplays.d.textContent = d.toFixed(2);
  dataDisplays.correction.textContent = corr.toFixed(2);
  dataDisplays.windup.textContent = windupPercent.toFixed(0) + '%';

  // Update windup status indicator
  const windupStatus = dataDisplays.windupStatus;
  windupStatus.className = 'status-indicator ' +
    (windupPercent < 50 ? 'status-good' :
       windupPercent < 80 ? 'status-warning' : 'status-error');
}

// --- Drawing ---
function draw() {
  roadCtx.clearRect(0, 0, roadCanvas.width, roadCanvas.height);
  drawRoad();
  drawCar();
  drawGraph();
}

function getLaneCenterY(x) {
  const centerY = roadCanvas.height / 2;
  const amplitude = 50 * pathParams.scale;

  switch(pathParams.type) {
    case 'straight':
      return centerY;

    case 'sine':
      return centerY + amplitude * Math.sin(0.005 * x);

    case 'circle':
      // Circular path - map x to angle around circle
      const radius = amplitude;
      const circumference = 2 * Math.PI * radius;
      const angle = (x * 2 * Math.PI) / (circumference * 2); // Complete circle every 2*circumference units
      return centerY + radius * Math.sin(angle);

    case 'rectangle':
      // Rectangular wave pattern
      const period = 400 * pathParams.scale;
      const phase = (x % period) / period;
      if (phase < 0.25) return centerY + amplitude; // Top edge
      else if (phase < 0.5) return centerY + amplitude - (amplitude * 2 * (phase - 0.25) / 0.25); // Right edge (descending)
      else if (phase < 0.75) return centerY - amplitude; // Bottom edge
      else return centerY - amplitude + (amplitude * 2 * (phase - 0.75) / 0.25); // Left edge (ascending)

    default: // This will handle any unexpected values or serve as a fallback
      return centerY + amplitude * Math.sin(0.005 * x);
  }
}

function drawRoad() {
  const laneWidth = 80;
  // Draw solid outer lane boundaries
  roadCtx.strokeStyle = 'rgba(100, 100, 100, 0.7)'; /* Darker, more visible borders */
  roadCtx.lineWidth = 5;
  for (let side = -1; side <= 1; side += 2) {
    roadCtx.beginPath();
    for (let x = 0; x <= roadCanvas.width; x += 10) {
        roadCtx.lineTo(x, getLaneCenterY(x) + side * laneWidth / 2);
    }
    roadCtx.stroke();
  }
  // Draw dashed center line
  roadCtx.setLineDash([20, 25]);
  roadCtx.lineWidth = 3;
  roadCtx.beginPath();
  for (let x = 0; x <= roadCanvas.width; x += 10) {
      roadCtx.lineTo(x, getLaneCenterY(x));
  }
  roadCtx.stroke();
  roadCtx.setLineDash([]);
}

function drawCar() {
  roadCtx.save();
  roadCtx.translate(car.x, car.y);
  roadCtx.rotate(car.heading);

  // Draw car body
  roadCtx.fillStyle = colors.primary;
  roadCtx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);

  // Draw car cabin
  roadCtx.fillStyle = 'rgba(0, 0, 0, 0.2)'; /* Darker cabin for contrast */
  roadCtx.fillRect(-car.width / 3, -car.height / 2 + 3, car.width * 0.6, car.height - 6);

  roadCtx.restore();
}

function drawGraph() {
    graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    const h = graphCanvas.height, w = graphCanvas.width, midY = h / 2;

    // Determine max Y value for scaling
    let currentMaxVal = 0;
    simulationState.history.forEach(point => {
        currentMaxVal = Math.max(currentMaxVal, Math.abs(point.p), Math.abs(point.i), Math.abs(point.d), Math.abs(point.error));
    });
    const graphMaxVal = Math.max(currentMaxVal * 1.2, 20); // Reduced minimum for better scaling

    // Draw horizontal mid-line (zero error line)
    graphCtx.strokeStyle = colors.border;
    graphCtx.lineWidth = 1;
    graphCtx.beginPath(); graphCtx.moveTo(0, midY); graphCtx.lineTo(w, midY); graphCtx.stroke();

    const plot = (term, color) => {
        if (simulationState.history.length < 2) return; // Need at least 2 points to draw
        graphCtx.strokeStyle = color; graphCtx.lineWidth = 2; graphCtx.beginPath();
        simulationState.history.forEach((point, i) => {
            const x = (i / simulationState.maxHistory) * w;
            const y = midY - (point[term] / graphMaxVal) * (midY * 0.9);
            if (i === 0) {
                graphCtx.moveTo(x, y);
            } else {
                graphCtx.lineTo(x, y);
            }
        });
        graphCtx.stroke();
    };

    // Plot Error (blue), P (green), I (orange), D (red)
    plot('error', colors.blue);
    plot('p', colors.green);
    plot('i', colors.orange);
    plot('d', colors.red);

    // Draw legend
    graphCtx.font = "12px Inter";
    graphCtx.fillStyle = colors.text; /* Changed legend text color */
    let legendX = 10;
    graphCtx.fillStyle = colors.blue; graphCtx.fillText('Error', legendX, 15); legendX += 45;
    graphCtx.fillStyle = colors.green; graphCtx.fillText('P', legendX, 15); legendX += 20;
    graphCtx.fillStyle = colors.orange; graphCtx.fillText('I', legendX, 15); legendX += 20;
    graphCtx.fillStyle = colors.red; graphCtx.fillText('D', legendX, 15);
}

// --- Run ---
init();
