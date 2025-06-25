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
  presetUnder: document.getElementById("presetUnder")
};

// --- Color Palette ---
const computedStyles = getComputedStyle(document.documentElement);
const colors = {
  primary: computedStyles.getPropertyValue('--primary-color').trim(),
  green: computedStyles.getPropertyValue('--green').trim(),
  red: computedStyles.getPropertyValue('--red').trim(),
  orange: computedStyles.getPropertyValue('--orange').trim(),
  blue: computedStyles.getPropertyValue('--blue').trim(),
  border: computedStyles.getPropertyValue('--border-color').trim(),
  surface: computedStyles.getPropertyValue('--surface-color').trim(),
  road: computedStyles.getPropertyValue('--road-color').trim(),
  text: computedStyles.getPropertyValue('--text-color').trim()
};

// --- Simulation & PID State ---
let simulationState = { 
  isRunning: false, 
  animationFrameId: null, 
  lastTimestamp: 0, 
  history: [], 
  maxHistory: 300, 
  firstUpdate: true 
};

let car = {};

// FIXED: Added lastError for improved integration and clearer PID state
let pid = { 
  kp: 0.4, 
  ki: 0.015, 
  kd: 0.5, 
  integral: 0, 
  lastError: 0,
  lastCarY: 0 
};

let pathParams = { type: 'sine', scale: 1.0 };

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
  graphCanvas.width = graphContainerWidth - dataDisplayWidth - 24;
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

  // FIXED: Proper initialization
  pid.integral = 0;
  pid.lastError = 0;
  pid.lastCarY = car.y;
  simulationState.history = [];
  simulationState.firstUpdate = true;
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
      car.disturbance = 60 * (clickY < car.y ? 1 : -1);
  };

  // FIXED: Corrected preset values
  buttons.presetP.onclick = () => setPreset(0.3, 0, 0);
  buttons.presetPI.onclick = () => setPreset(0.2, 0.015, 0);
  buttons.presetUnder.onclick = () => setPreset(0.4, 0.015, 0.5);
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

  // FIXED: Better time step handling with derivative protection
  const clampedDt = Math.max(0.002, Math.min(dt, 0.05)); // Increased minimum to 2ms

  update(clampedDt);
  draw();
  simulationState.animationFrameId = requestAnimationFrame(gameLoop);
}

function update(dt) {
  if (car.x > roadCanvas.width + car.width) resetCar();

  const centerlineY = getLaneCenterY(car.x);
  
  // FIXED: Consistent error convention - desired minus actual
  const error = centerlineY - car.y;

  // PROPORTIONAL TERM
  const pTerm = pid.kp * error;

  // FIXED: Improved integral term with proper Ki=0 handling
  let iTerm = 0;
  if (pid.ki > 0.001) {
    // FIXED: Trapezoidal integration for better accuracy
    pid.integral += (error + pid.lastError) * dt / 2;
    
    // FIXED: Anti-windup limits that scale with Ki gain
    const maxIntegralContribution = 100;
    const maxIntegral = maxIntegralContribution / pid.ki;
    pid.integral = Math.max(-maxIntegral, Math.min(maxIntegral, pid.integral));
    
    iTerm = pid.ki * pid.integral;
  } else {
    // When Ki is effectively zero, reset integral
    pid.integral = 0;
  }

  // FIXED: Derivative on measurement with proper sign convention
  let dTerm = 0;
  if (!simulationState.firstUpdate && pid.kd > 0.001) {
    // Derivative of process variable (car position) to prevent derivative kick
    const processDerivative = (car.y - pid.lastCarY) / dt;
    dTerm = -pid.kd * processDerivative; // Negative because derivative on measurement
    
    // FIXED: Derivative filtering for numerical stability on small time steps
    if (dt < 0.005) {
      dTerm *= dt / 0.005; // Scale down derivative for very small steps
    }
  }
  
  simulationState.firstUpdate = false;
  pid.lastCarY = car.y;
  pid.lastError = error; // Store for next trapezoidal integration

  const correction = pTerm + iTerm + dTerm;

  // Apply external disturbance
  if (Math.abs(car.disturbance) > 0.1) {
      car.y += car.disturbance * dt;
      car.disturbance *= 0.95;
  }

  // FIXED: Improved steering with rate limiting (more realistic)
  const maxSteerAngle = Math.PI / 4; // 45 degrees max
  const maxSteerRate = Math.PI / 2;  // 90 degrees per second max rate
  const steeringSensitivity = 0.008;
  
  // FIXED: Removed negative sign for consistent error convention
  const desiredHeading = Math.max(-maxSteerAngle, Math.min(maxSteerAngle, correction * steeringSensitivity));
  
  // FIXED: Add steering rate limiting for realism
  const headingChange = Math.max(-maxSteerRate * dt, Math.min(maxSteerRate * dt, desiredHeading - car.heading));
  car.heading += headingChange;

  // Update car position
  car.x += car.velocity * Math.cos(car.heading);
  car.y += car.velocity * Math.sin(car.heading);

  // Store history for plotting
  simulationState.history.push({ p: pTerm, i: iTerm, d: dTerm, error: error });
  if (simulationState.history.length > simulationState.maxHistory) simulationState.history.shift();

  // Calculate windup percentage for monitoring
  const windupPercentage = pid.ki > 0.001 ? Math.abs(pid.integral / (100 / pid.ki)) * 100 : 0;

  updateDataDisplays(error, pTerm, iTerm, dTerm, correction, windupPercentage);
}

function updateDataDisplays(error, p, i, d, corr, windupPercent = 0) {
  dataDisplays.error.textContent = error.toFixed(2);
  dataDisplays.p.textContent = p.toFixed(2);
  dataDisplays.i.textContent = i.toFixed(2);
  dataDisplays.d.textContent = d.toFixed(2);
  dataDisplays.correction.textContent = corr.toFixed(2);
  dataDisplays.windup.textContent = windupPercent.toFixed(0) + '%';

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
      // FIXED: Corrected circular path mathematics
      const radius = amplitude;
      const circumference = 2 * Math.PI * radius;
      const angle = (x * 2 * Math.PI) / circumference; // Removed extra *2
      return centerY + radius * Math.sin(angle);

    case 'rectangle':
      const period = 400 * pathParams.scale;
      const phase = (x % period) / period;
      if (phase < 0.25) return centerY + amplitude;
      else if (phase < 0.5) return centerY + amplitude - (amplitude * 2 * (phase - 0.25) / 0.25);
      else if (phase < 0.75) return centerY - amplitude;
      else return centerY - amplitude + (amplitude * 2 * (phase - 0.75) / 0.25);

    case 'figure8':
      const freq1 = 0.003 * pathParams.scale;
      const freq2 = 0.006 * pathParams.scale;
      return centerY + amplitude * 0.8 * Math.sin(freq1 * x) * Math.cos(freq2 * x);

    case 'spiral':
      const spiralRate = 0.001 * pathParams.scale;
      const spiralAmplitude = Math.min(amplitude, (x * spiralRate) % (amplitude * 2));
      return centerY + spiralAmplitude * Math.sin(0.01 * x);

    default:
      return centerY + amplitude * Math.sin(0.005 * x);
  }
}

function drawRoad() {
  const laneWidth = 80;
  roadCtx.strokeStyle = 'rgba(100, 100, 100, 0.7)';
  roadCtx.lineWidth = 5;
  for (let side = -1; side <= 1; side += 2) {
    roadCtx.beginPath();
    for (let x = 0; x <= roadCanvas.width; x += 10) {
        roadCtx.lineTo(x, getLaneCenterY(x) + side * laneWidth / 2);
    }
    roadCtx.stroke();
  }
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

  roadCtx.fillStyle = colors.primary;
  roadCtx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);

  roadCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  roadCtx.fillRect(-car.width / 3, -car.height / 2 + 3, car.width * 0.6, car.height - 6);

  roadCtx.restore();
}

function drawGraph() {
    graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    const h = graphCanvas.height, w = graphCanvas.width, midY = h / 2;

    let currentMaxVal = 0;
    simulationState.history.forEach(point => {
        currentMaxVal = Math.max(currentMaxVal, Math.abs(point.p), Math.abs(point.i), Math.abs(point.d), Math.abs(point.error));
    });
    const graphMaxVal = Math.max(currentMaxVal * 1.2, 20);

    graphCtx.strokeStyle = colors.border;
    graphCtx.lineWidth = 1;
    graphCtx.beginPath(); graphCtx.moveTo(0, midY); graphCtx.lineTo(w, midY); graphCtx.stroke();

    const plot = (term, color) => {
        if (simulationState.history.length < 2) return;
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

    plot('error', colors.blue);
    plot('p', colors.green);
    plot('i', colors.orange);
    plot('d', colors.red);

    graphCtx.font = "12px Inter";
    let legendX = 10;
    graphCtx.fillStyle = colors.blue; graphCtx.fillText('Error', legendX, 15); legendX += 45;
    graphCtx.fillStyle = colors.green; graphCtx.fillText('P', legendX, 15); legendX += 20;
    graphCtx.fillStyle = colors.orange; graphCtx.fillText('I', legendX, 15); legendX += 20;
    graphCtx.fillStyle = colors.red; graphCtx.fillText('D', legendX, 15);
}

// --- Run ---
init();
