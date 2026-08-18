(() => {
  const root = document.documentElement;
  const body = document.body;
  const main = document.querySelector('.sidebar-main');
  const sidebarContent = document.querySelector('.sidebar-content');
  const pageLoader = document.querySelector('.page-loader');
  const sidebarPanel = document.querySelector('.sidebar-panel');
  const waterDepthCanvas = document.querySelector('.sidebar-water-depth');
  const waterSurfaceCanvas = document.querySelector('.sidebar-water-surface');
  const skipLink = document.querySelector('.skip-link');
  const themeToggle = document.querySelector('.theme-toggle');
  const menuToggle = document.querySelector('.sidebar-menu-toggle');
  const pageLinks = [...document.querySelectorAll('[data-page-link]')];
  const pages = [...document.querySelectorAll('[data-page]')];
  const currentYears = [...document.querySelectorAll('[data-current-year]')];
  const journeyTimelineStops = [...document.querySelectorAll('[data-timeline-target]')];
  const researchProjectDisclosures = [...document.querySelectorAll('.research-project')];
  const projectSphere = document.querySelector('[data-project-sphere]');
  const projectFields = [...document.querySelectorAll('[data-project-field]')];
  const projectMapButtons = [...document.querySelectorAll('[data-project-target]')];
  const sectionNavigations = {
    background: {
      navLink: document.querySelector('#background-nav-link'),
      submenu: document.querySelector('#background-submenu'),
      links: [...document.querySelectorAll('[data-background-section]')],
      dataKey: 'backgroundSection',
      validSections: new Set(['education', 'work-experience', 'standardized-tests']),
    },
    projects: {
      navLink: document.querySelector('#projects-nav-link'),
      submenu: document.querySelector('#projects-submenu'),
      links: [...document.querySelectorAll('[data-project-section]')],
      dataKey: 'projectSection',
      validSections: new Set(['industry-projects', 'personal-projects', 'academic-projects']),
    },
    awards: {
      navLink: document.querySelector('#awards-nav-link'),
      submenu: document.querySelector('#awards-submenu'),
      links: [...document.querySelectorAll('[data-awards-section]')],
      dataKey: 'awardsSection',
      validSections: new Set(['scholarships-grants', 'competitions', 'presentations']),
    },
  };

  const pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const surfaceContext = waterSurfaceCanvas?.getContext('2d', { alpha: true });
  const wakeSamples = [];
  const wakeLifetime = 1900;
  const maxWakeSamples = 110;
  const idleFlowRate = 1.8;
  const maxCausticPixels = 700000;
  const loaderGracePeriod = 400;
  const loaderMinimumVisible = 1050;

  let depthContext = null;
  let waterRenderer = null;
  let waterContextLost = false;
  let waterDepthInitialized = false;

  let waterWidth = 0;
  let waterHeight = 0;
  let waterDepthPixelRatio = 0;
  let waterSurfacePixelRatio = 0;
  let waterFrame = 0;
  let lastCausticFrame = 0;
  let wakeCanvasDirty = false;
  let wakeSequence = 0;
  let wakeRun = 0;
  let isPointerTracking = false;
  let sidebarRect = null;
  let lastPointer = null;
  let smoothedDirection = null;
  let timelineTargetTimer = 0;
  let projectSphereFrame = 0;
  let projectSphereRect = null;
  let focusedProjectField = null;
  let projectMapTargetTimer = 0;
  let pageLoadGeneration = 0;
  let pageLoaderExitTimer = 0;
  let pageLoaderStartedAt = 0;
  let activeNavigationController = null;
  const sidebarSubmenuAnimations = new WeakMap();
  const projectSpherePointer = { x: 0.5, y: 0.5, active: false };

  const waterVertexShader = `
    attribute vec2 a_position;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const waterFragmentShader = (precision) => `
    precision ${precision} float;

    uniform vec2 u_resolution;
    uniform float u_time;

    const float TAU = 6.28318530718;

    vec2 hash22(vec2 point) {
      point = vec2(
        dot(point, vec2(127.1, 311.7)),
        dot(point, vec2(269.5, 183.3))
      );
      return fract(sin(point) * 43758.5453123);
    }

    float hash12(vec2 point) {
      return fract(sin(dot(point, vec2(41.37, 289.11))) * 43758.5453123);
    }

    float waterNoise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      vec2 eased = local * local * (3.0 - 2.0 * local);
      return mix(
        mix(hash12(cell), hash12(cell + vec2(1.0, 0.0)), eased.x),
        mix(hash12(cell + vec2(0.0, 1.0)), hash12(cell + vec2(1.0, 1.0)), eased.x),
        eased.y
      );
    }

    vec2 waterWarp(vec2 point, float time) {
      vec2 warped = point;
      warped.x += 0.17 * sin(point.y * 1.08 + time * 0.28)
        + 0.075 * sin(point.y * 2.38 - time * 0.19);
      warped.y += 0.14 * sin(point.x * 0.92 - time * 0.23)
        + 0.065 * sin(point.x * 2.07 + time * 0.16);
      return warped;
    }

    float causticRidge(vec2 point, float time) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      float nearest = 8.0;
      float secondNearest = 8.0;

      for (int y = -1; y <= 1; y += 1) {
        for (int x = -1; x <= 1; x += 1) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 randomValue = hash22(cell + neighbor);
          vec2 feature = 0.5 + 0.33 * sin(TAU * randomValue + time * vec2(0.34, 0.27));
          vec2 delta = neighbor + feature - local;
          float distanceSquared = dot(delta, delta);

          if (distanceSquared < nearest) {
            secondNearest = nearest;
            nearest = distanceSquared;
          } else if (distanceSquared < secondNearest) {
            secondNearest = distanceSquared;
          }
        }
      }

      float edge = sqrt(secondNearest) - sqrt(nearest);
      return 1.0 - smoothstep(0.022, 0.12, edge);
    }

    vec3 waterSurfaceNormal(vec2 point, float time) {
      vec2 gradient = vec2(0.0);

      vec2 directionA = normalize(vec2(1.0, 0.26));
      vec2 directionB = normalize(vec2(-0.36, 1.0));
      vec2 directionC = normalize(vec2(0.74, -0.68));
      vec2 directionD = normalize(vec2(-0.91, -0.41));
      vec2 directionE = normalize(vec2(0.17, 1.0));

      gradient += directionA * 0.2 * cos(dot(point, directionA) * 1.18 + time * 0.43);
      gradient += directionB * 0.18 * cos(dot(point, directionB) * 1.47 - time * 0.37 + 1.2);
      gradient += directionC * 0.13 * cos(dot(point, directionC) * 2.16 + time * 0.56 + 2.4);
      gradient += directionD * 0.1 * cos(dot(point, directionD) * 2.84 - time * 0.48 + 0.7);
      gradient += directionE * 0.07 * cos(dot(point, directionE) * 4.1 + time * 0.66 + 3.1);

      return normalize(vec3(-gradient.x, -gradient.y, 0.82));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 point = gl_FragCoord.xy / u_resolution.x * 8.15;
      float time = u_time;

      vec2 broad = waterWarp(point + vec2(time * 0.024, -time * 0.013), time);
      vec2 fine = waterWarp(
        point * 1.74 + vec2(3.7, -1.4) - vec2(time * 0.018, time * 0.011),
        -time * 0.76
      );

      float broadCaustic = pow(causticRidge(broad, time * 0.31), 2.15);
      float fineCaustic = pow(causticRidge(fine, time * 0.24 + 2.3), 2.75);
      float broadMask = smoothstep(
        0.22,
        0.75,
        waterNoise(broad * 0.34 + vec2(time * 0.025, -time * 0.017))
      );
      float fineMask = smoothstep(
        0.18,
        0.79,
        waterNoise(fine * 0.2 - vec2(time * 0.019, time * 0.013) + 4.7)
      );
      broadCaustic *= 0.035 + broadMask * 0.7;
      fineCaustic *= 0.015 + fineMask * 0.52;
      float caustic = min(1.0, broadCaustic * 0.3 + fineCaustic * 0.08);
      float diffusedLight = mix(
        waterNoise(broad * 0.15 + vec2(-time * 0.011, time * 0.009)),
        waterNoise(fine * 0.075 + vec2(time * 0.008, time * 0.012) + 7.2),
        0.42
      );
      diffusedLight = smoothstep(0.16, 0.86, diffusedLight);

      float swell = 0.5 + 0.5 * sin(
        broad.x * 0.72 + sin(broad.y * 0.65 + time * 0.14) * 1.28 - time * 0.2
      );
      float crossing = 0.5 + 0.5 * sin(broad.y * 0.82 - broad.x * 0.27 + time * 0.16);
      float depth = swell * 0.62 + crossing * 0.38;

      float depthVariation = waterNoise(point * 0.16 + vec2(-time * 0.012, time * 0.009));
      vec3 surfaceNormal = waterSurfaceNormal(point * 0.72, time);
      vec3 lightDirection = normalize(vec3(-0.42, 0.31, 0.86));
      vec3 viewDirection = vec3(0.0, 0.0, 1.0);
      float surfaceLight = 0.5 + 0.5 * dot(surfaceNormal, lightDirection);
      float reflection = pow(
        max(dot(reflect(-lightDirection, surfaceNormal), viewDirection), 0.0),
        24.0
      );
      float grazingLight = pow(1.0 - surfaceNormal.z, 2.0);
      vec3 deepWater = vec3(0.028, 0.165, 0.225);
      vec3 liftedWater = vec3(0.06, 0.305, 0.385);
      vec3 color = mix(
        deepWater,
        liftedWater,
        0.15 + 0.2 * depth + 0.12 * depthVariation + 0.2 * surfaceLight
      );
      color += vec3(0.12, 0.32, 0.4) * reflection * 0.5;
      color += vec3(0.025, 0.1, 0.14) * grazingLight * 0.7;
      color += vec3(0.13, 0.34, 0.41) * diffusedLight * 0.12;
      color += vec3(0.16, 0.39, 0.46) * caustic * 0.045;

      float sideLight = smoothstep(0.0, 0.17, uv.x)
        * smoothstep(0.0, 0.17, 1.0 - uv.x);
      float glassDepth = 0.96 + 0.04 * sin(uv.y * 8.0 + time * 0.11);
      color *= mix(0.87, 1.0, sideLight) * glassDepth;

      gl_FragColor = vec4(color, 0.94);
    }
  `;

  const compileWaterShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

    console.warn('Water shader compilation failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  };

  const buildWaterRenderer = () => {
    if (!waterDepthCanvas) return null;

    const options = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    };
    const gl = waterDepthCanvas.getContext('webgl', options)
      || waterDepthCanvas.getContext('experimental-webgl', options);
    if (!gl) return null;

    const highPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const precision = highPrecision?.precision ? 'highp' : 'mediump';
    const vertexShader = compileWaterShader(gl, gl.VERTEX_SHADER, waterVertexShader);
    const fragmentShader = compileWaterShader(gl, gl.FRAGMENT_SHADER, waterFragmentShader(precision));
    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Water shader linking failed:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    const positionBuffer = gl.createBuffer();
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    if (!positionBuffer || positionLocation < 0 || !resolutionLocation || !timeLocation) return null;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    return {
      gl,
      positionBuffer,
      positionLocation,
      program,
      resolutionLocation,
      timeLocation,
    };
  };

  const initializeWaterDepth = () => {
    if (
      waterDepthInitialized
      || waterContextLost
      || !waterDepthCanvas
      || window.innerWidth < 768
    ) return;

    waterDepthInitialized = true;
    waterRenderer = buildWaterRenderer();
    waterDepthCanvas?.classList.toggle('is-caustic-ready', Boolean(waterRenderer));

    if (!waterRenderer && !waterContextLost) {
      depthContext = waterDepthCanvas?.getContext('2d', { alpha: true }) ?? null;
    }
    waterDepthCanvas?.classList.toggle('is-fallback', Boolean(depthContext));
    waterDepthCanvas?.classList.toggle('is-unavailable', !waterRenderer && !depthContext);
  };

  const canTrackPointer = () => (
    pointerQuery.matches
    && window.innerWidth >= 768
    && !body.classList.contains('page-is-loading')
  );
  const canRenderWater = () => (
    window.innerWidth >= 768
    && !document.hidden
    && surfaceContext
    && waterWidth > 0
    && waterHeight > 0
  );

  const currentY = (x, baseY, amplitude, phase, time, speed) => {
    const flowingX = x - time * speed;
    return baseY
      + Math.sin(flowingX * 0.015 + phase) * amplitude
      + Math.sin(flowingX * 0.0054 - phase * 0.68) * amplitude * 0.43
      + x * 0.014;
  };

  const traceCurrent = (context, baseY, amplitude, phase, time, speed, verticalOffset = 0) => {
    context.beginPath();
    for (let x = -48; x <= waterWidth + 48; x += 12) {
      const y = currentY(x, baseY, amplitude, phase, time, speed) + verticalOffset;
      if (x === -48) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  };

  const traceCurrentBand = (context, baseY, amplitude, phase, time, speed, thickness) => {
    context.beginPath();
    for (let x = -48; x <= waterWidth + 48; x += 14) {
      const y = currentY(x, baseY, amplitude, phase, time, speed) - thickness * 0.5;
      if (x === -48) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    for (let x = waterWidth + 48; x >= -48; x -= 14) {
      context.lineTo(x, currentY(x, baseY, amplitude, phase, time, speed) + thickness * 0.5);
    }
    context.closePath();
  };

  const drawDeepCurrent = (time) => {
    depthContext.clearRect(0, 0, waterWidth, waterHeight);
    depthContext.save();
    depthContext.lineCap = 'round';
    depthContext.lineJoin = 'round';

    const currentCount = Math.max(6, Math.min(9, Math.round(waterHeight / 125)));
    for (let index = 0; index < currentCount; index += 1) {
      const baseY = ((index + 0.36) / currentCount) * waterHeight;
      const amplitude = 13 + (index % 3) * 4;
      const phase = index * 0.88;
      const speed = (0.013 + (index % 2) * 0.002) * idleFlowRate;
      const thickness = 38 + (index % 3) * 10;

      depthContext.globalCompositeOperation = 'source-over';
      traceCurrentBand(depthContext, baseY + 6, amplitude, phase, time, speed, thickness + 9);
      depthContext.fillStyle = `rgba(9, 52, 72, ${0.045 + (index % 3) * 0.008})`;
      depthContext.fill();

      depthContext.globalCompositeOperation = 'screen';
      traceCurrentBand(depthContext, baseY, amplitude, phase, time, speed, thickness);
      depthContext.fillStyle = `rgba(${58 + (index % 2) * 12}, ${151 + (index % 3) * 7}, ${184 + (index % 2) * 11}, ${0.075 + (index % 3) * 0.012})`;
      depthContext.fill();

      traceCurrent(depthContext, baseY - thickness * 0.34, amplitude, phase, time, speed);
      depthContext.lineWidth = 5 + (index % 3) * 1.5;
      depthContext.strokeStyle = `rgba(116, 190, 210, ${0.065 + (index % 2) * 0.015})`;
      depthContext.stroke();
    }

    depthContext.restore();
  };

  const drawSurfaceCurrent = (time) => {
    surfaceContext.save();
    surfaceContext.lineCap = 'round';
    surfaceContext.lineJoin = 'round';

    const currentCount = Math.max(8, Math.min(12, Math.round(waterHeight / 92)));
    for (let index = 0; index < currentCount; index += 1) {
      const baseY = ((index + 0.3) / currentCount) * waterHeight;
      const amplitude = 6.5 + (index % 4) * 1.7;
      const phase = index * 0.71;
      const speed = (0.017 + (index % 3) * 0.0017) * idleFlowRate;

      surfaceContext.globalCompositeOperation = 'source-over';
      surfaceContext.setLineDash([]);
      traceCurrent(surfaceContext, baseY, amplitude, phase, time, speed, 2.5);
      surfaceContext.lineWidth = 4.5 + (index % 2) * 1.2;
      surfaceContext.strokeStyle = `rgba(8, 51, 70, ${0.08 + (index % 3) * 0.012})`;
      surfaceContext.stroke();

      surfaceContext.globalCompositeOperation = 'screen';
      traceCurrent(surfaceContext, baseY, amplitude, phase, time, speed);
      surfaceContext.setLineDash([44 + (index % 3) * 15, 46 + (index % 2) * 17]);
      surfaceContext.lineDashOffset = -time * (0.021 + (index % 3) * 0.002) * idleFlowRate - index * 23;
      surfaceContext.lineWidth = 1.1 + (index % 3) * 0.25;
      surfaceContext.strokeStyle = `rgba(${123 + (index % 2) * 12}, ${193 + (index % 3) * 5}, ${214 + (index % 2) * 6}, ${0.09 + (index % 3) * 0.014})`;
      surfaceContext.stroke();
    }

    surfaceContext.setLineDash([]);
    surfaceContext.restore();
  };

  const wakePosition = (sample, age) => {
    const settled = 1 - Math.exp(-age / 320);
    return {
      x: sample.x + sample.dx * age * 0.0032 + age * 0.002,
      y: sample.y
        + sample.dy * age * 0.0024
        + Math.sin(age * 0.0038 + sample.id * 0.52) * 3.2 * settled,
    };
  };

  const drawWakeFlow = (time) => {
    for (let index = 1; index < wakeSamples.length; index += 1) {
      const previous = wakeSamples[index - 1];
      const current = wakeSamples[index];
      const previousAge = time - previous.born;
      const currentAge = time - current.born;
      if (previousAge < 0 || currentAge < 0 || previousAge > wakeLifetime || currentAge > wakeLifetime) continue;
      if (previous.run !== current.run) continue;
      if (current.born - previous.born > 105) continue;

      const previousLife = previousAge / wakeLifetime;
      const currentLife = currentAge / wakeLifetime;
      const previousCenter = wakePosition(previous, previousAge);
      const currentCenter = wakePosition(current, currentAge);
      const averageAge = (previousAge + currentAge) * 0.5;
      const expansion = 1 - Math.exp(-averageAge / 380);
      const fade = Math.pow(1 - Math.max(previousLife, currentLife), 1.35);
      const strength = (previous.speed + current.speed) * 0.5;
      const outerWidth = 30 + expansion * (72 + strength * 52);
      const innerWidth = outerWidth * (0.44 + strength * 0.08);
      const midpointX = (previousCenter.x + currentCenter.x) * 0.5;
      const midpointY = (previousCenter.y + currentCenter.y) * 0.5;
      const curl = Math.sin(current.id * 0.63 + time * 0.0012) * (2 + expansion * 5);

      const traceFlow = () => {
        surfaceContext.beginPath();
        surfaceContext.moveTo(previousCenter.x, previousCenter.y);
        surfaceContext.quadraticCurveTo(
          midpointX - current.dy * curl,
          midpointY + current.dx * curl,
          currentCenter.x,
          currentCenter.y,
        );
      };

      surfaceContext.globalCompositeOperation = 'source-over';
      traceFlow();
      surfaceContext.lineWidth = outerWidth;
      surfaceContext.strokeStyle = `rgba(8, 65, 86, ${fade * (0.02 + strength * 0.028)})`;
      surfaceContext.stroke();

      surfaceContext.globalCompositeOperation = 'screen';
      traceFlow();
      surfaceContext.lineWidth = innerWidth;
      surfaceContext.strokeStyle = `rgba(73, 166, 191, ${fade * (0.024 + strength * 0.036)})`;
      surfaceContext.stroke();
    }
  };

  const drawWake = (time) => {
    while (wakeSamples.length && time - wakeSamples[0].born > wakeLifetime) wakeSamples.shift();
    if (!wakeSamples.length) return;

    surfaceContext.save();
    surfaceContext.lineCap = 'round';
    surfaceContext.lineJoin = 'round';
    drawWakeFlow(time);
    surfaceContext.restore();
  };

  const renderCausticWater = (time) => {
    if (!waterRenderer || waterContextLost || !waterDepthCanvas) return;

    const {
      gl,
      positionBuffer,
      positionLocation,
      program,
      resolutionLocation,
      timeLocation,
    } = waterRenderer;
    gl.viewport(0, 0, waterDepthCanvas.width, waterDepthCanvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(resolutionLocation, waterDepthCanvas.width, waterDepthCanvas.height);
    gl.uniform1f(timeLocation, ((time * 0.001 * idleFlowRate) % 4096));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const renderWater = (time) => {
    waterFrame = 0;
    if (!canRenderWater()) return;

    if (waterRenderer && !waterContextLost) {
      if (!lastCausticFrame || time - lastCausticFrame >= 30) {
        renderCausticWater(time);
        lastCausticFrame = time;
      }
    } else if (depthContext) {
      drawDeepCurrent(time);
    }

    const drawsFallbackSurface = !waterRenderer && depthContext;
    if (drawsFallbackSurface || wakeSamples.length || wakeCanvasDirty) {
      surfaceContext.clearRect(0, 0, waterWidth, waterHeight);
      if (drawsFallbackSurface) drawSurfaceCurrent(time);
      drawWake(time);
      wakeCanvasDirty = wakeSamples.length > 0;
    }
    waterFrame = requestAnimationFrame(renderWater);
  };

  const startWater = () => {
    if (!waterFrame && canRenderWater()) waterFrame = requestAnimationFrame(renderWater);
  };

  const stopWater = () => {
    if (waterFrame) cancelAnimationFrame(waterFrame);
    waterFrame = 0;
  };

  const size2DWaterCanvas = (canvas, context, width, height, pixelRatio) => {
    if (!canvas || !context) return;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };

  const sizeDepthWaterCanvas = (width, height, pixelRatio) => {
    if (!waterDepthCanvas || (!waterRenderer && !depthContext)) return;
    waterDepthCanvas.width = Math.max(1, Math.round(width * pixelRatio));
    waterDepthCanvas.height = Math.max(1, Math.round(height * pixelRatio));

    if (waterRenderer) {
      waterRenderer.gl.viewport(0, 0, waterDepthCanvas.width, waterDepthCanvas.height);
    } else {
      depthContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
  };

  const resizeWater = () => {
    const rect = sidebarPanel?.getBoundingClientRect();
    if (!rect) return;
    initializeWaterDepth();

    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const devicePixelRatio = window.devicePixelRatio || 1;
    const surfacePixelRatio = Math.min(devicePixelRatio, 1.25);
    const uncappedDepthRatio = Math.min(devicePixelRatio, 1.25);
    const depthPixelCount = width * height * uncappedDepthRatio * uncappedDepthRatio;
    const depthPixelRatio = uncappedDepthRatio * Math.min(
      1,
      Math.sqrt(maxCausticPixels / Math.max(depthPixelCount, 1)),
    );
    const sizeChanged = width !== waterWidth
      || height !== waterHeight
      || depthPixelRatio !== waterDepthPixelRatio
      || surfacePixelRatio !== waterSurfacePixelRatio;
    sidebarRect = rect;

    if (sizeChanged) {
      waterWidth = width;
      waterHeight = height;
      waterDepthPixelRatio = depthPixelRatio;
      waterSurfacePixelRatio = surfacePixelRatio;
      sizeDepthWaterCanvas(width, height, depthPixelRatio);
      size2DWaterCanvas(waterSurfaceCanvas, surfaceContext, width, height, surfacePixelRatio);
      lastCausticFrame = 0;
      wakeSamples.length = 0;
      wakeCanvasDirty = false;
      lastPointer = null;
      smoothedDirection = null;
    }

    if (canRenderWater()) startWater();
    else stopWater();
  };

  const pointerPositionInSidebar = (event) => {
    sidebarRect ||= sidebarPanel?.getBoundingClientRect();
    if (!sidebarRect) return null;

    return {
      x: Math.min(sidebarRect.width, Math.max(0, event.clientX - sidebarRect.left)),
      y: Math.min(sidebarRect.height, Math.max(0, event.clientY - sidebarRect.top)),
    };
  };

  const startPointerWake = (event) => {
    if (event.pointerType !== 'mouse' || !canTrackPointer()) return;
    sidebarRect = sidebarPanel?.getBoundingClientRect() ?? null;
    const position = pointerPositionInSidebar(event);
    if (!position) return;

    isPointerTracking = true;
    wakeRun += 1;
    lastPointer = { ...position, time: performance.now() };
    smoothedDirection = null;
  };

  const addPointerWake = (position, time) => {
    if (!lastPointer) {
      lastPointer = { ...position, time };
      return;
    }

    const movementX = position.x - lastPointer.x;
    const movementY = position.y - lastPointer.y;
    const distance = Math.hypot(movementX, movementY);
    if (distance < 1.5) return;

    const rawDirection = { x: movementX / distance, y: movementY / distance };
    const elapsed = time - lastPointer.time;
    if (!smoothedDirection || elapsed > 90) {
      smoothedDirection = rawDirection;
    } else {
      const directionX = smoothedDirection.x * 0.68 + rawDirection.x * 0.32;
      const directionY = smoothedDirection.y * 0.68 + rawDirection.y * 0.32;
      const directionLength = Math.hypot(directionX, directionY) || 1;
      smoothedDirection = { x: directionX / directionLength, y: directionY / directionLength };
    }

    const speed = Math.min(1, distance / Math.max(6, Math.min(elapsed, 48)) / 1.35);
    const sampleCount = Math.min(8, Math.max(1, Math.ceil(distance / 14)));
    const sampleDuration = Math.min(Math.max(elapsed, 8), 42);

    for (let index = 1; index <= sampleCount; index += 1) {
      const progress = index / sampleCount;
      wakeSamples.push({
        id: wakeSequence += 1,
        run: wakeRun,
        x: lastPointer.x + movementX * progress,
        y: lastPointer.y + movementY * progress,
        dx: smoothedDirection.x,
        dy: smoothedDirection.y,
        speed: Math.max(0.12, speed),
        born: time - sampleDuration * (1 - progress),
      });
      wakeCanvasDirty = true;
    }

    if (wakeSamples.length > maxWakeSamples) {
      wakeSamples.splice(0, wakeSamples.length - maxWakeSamples);
    }
    lastPointer = { ...position, time };
  };

  const updatePointerWake = (event) => {
    if (event.pointerType !== 'mouse' || !canTrackPointer()) return;
    if (!isPointerTracking) startPointerWake(event);

    const coalescedEvents = event.getCoalescedEvents?.() ?? [];
    const events = coalescedEvents.length ? coalescedEvents : [event];
    const now = performance.now();
    events.forEach((pointerEvent, index) => {
      const position = pointerPositionInSidebar(pointerEvent);
      if (position) addPointerWake(position, now - (events.length - index - 1) * 2);
    });
  };

  const stopPointerWake = () => {
    isPointerTracking = false;
    sidebarRect = null;
    lastPointer = null;
    smoothedDirection = null;
  };

  const waitForDelay = (duration, signal) => new Promise((resolve) => {
    if (!duration || signal?.aborted) {
      resolve();
      return;
    }

    const timer = window.setTimeout(settle, duration);
    function settle() {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', settle);
      resolve();
    }
    signal?.addEventListener('abort', settle, { once: true });
  });

  const waitForImage = (image, signal) => new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    image.loading = 'eager';
    let settled = false;

    const cleanup = () => {
      image.removeEventListener('load', finish);
      image.removeEventListener('error', finish);
      signal?.removeEventListener('abort', finish);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const decoded = image.complete && typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : Promise.resolve();
      decoded.finally(resolve);
    };

    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    signal?.addEventListener('abort', finish, { once: true });
    if (image.complete) finish();
  });

  const waitForPageAssets = (pageName, signal) => {
    const page = pages.find((candidate) => candidate.dataset.page === pageName);
    const images = page ? [...page.querySelectorAll('img')] : [];
    return Promise.all(images.map((image) => waitForImage(image, signal)));
  };

  const beginPageLoading = () => {
    const loaderWasVisible = body.classList.contains('page-is-loading');
    window.clearTimeout(pageLoaderExitTimer);
    body.classList.remove('page-loader-exiting');
    body.classList.add('page-is-loading');
    if (!loaderWasVisible) pageLoaderStartedAt = performance.now();
    main?.setAttribute('aria-busy', 'true');
    pageLoader?.setAttribute('aria-hidden', 'false');

    if (sidebarContent?.contains(document.activeElement)) {
      main?.focus({ preventScroll: true });
    }
    if (sidebarContent) {
      sidebarContent.inert = true;
      sidebarContent.setAttribute('aria-hidden', 'true');
    }

    stopPointerWake();
    wakeSamples.length = 0;
    wakeCanvasDirty = true;
  };

  const finishPageLoading = () => {
    if (sidebarContent) {
      sidebarContent.inert = false;
      sidebarContent.removeAttribute('inert');
      sidebarContent.removeAttribute('aria-hidden');
    }
    main?.setAttribute('aria-busy', 'false');
    pageLoader?.setAttribute('aria-hidden', 'true');

    body.classList.add('page-loader-exiting');
    body.classList.remove('page-is-loading');
    pageLoaderStartedAt = 0;
    window.clearTimeout(pageLoaderExitTimer);
    pageLoaderExitTimer = window.setTimeout(() => {
      body.classList.remove('page-loader-exiting');
    }, 1150);
  };

  const setThemeButtonLabel = () => {
    const isDark = root.dataset.theme === 'dark';
    themeToggle?.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
  };

  const setMenu = (isOpen) => {
    body.classList.toggle('nav-open', isOpen);
    menuToggle?.setAttribute('aria-expanded', String(isOpen));
    menuToggle?.setAttribute('aria-label', isOpen ? 'Close profile and navigation' : 'Open profile and navigation');
  };

  const animateResearchDisclosure = (disclosure) => {
    const summary = disclosure.querySelector('summary');
    if (!summary) return;

    let animation = null;

    summary.addEventListener('click', (event) => {
      event.preventDefault();

      if (animation) {
        animation.cancel();
        animation = null;
        disclosure.style.height = '';
        disclosure.style.overflow = '';
        disclosure.removeAttribute('data-closing');
      }

      const shouldOpen = !disclosure.open || disclosure.hasAttribute('data-closing');
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) {
        disclosure.open = shouldOpen;
        disclosure.removeAttribute('data-closing');
        return;
      }

      const startHeight = disclosure.offsetHeight;
      if (shouldOpen) {
        disclosure.open = true;
        const endHeight = disclosure.offsetHeight;
        disclosure.style.height = `${startHeight}px`;
        disclosure.style.overflow = 'hidden';
        animation = disclosure.animate(
          { height: [`${startHeight}px`, `${endHeight}px`] },
          { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      } else {
        disclosure.open = false;
        const endHeight = disclosure.offsetHeight;
        disclosure.open = true;
        disclosure.setAttribute('data-closing', '');
        disclosure.style.height = `${startHeight}px`;
        disclosure.style.overflow = 'hidden';
        animation = disclosure.animate(
          { height: [`${startHeight}px`, `${endHeight}px`] },
          { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
        );
      }

      animation.onfinish = () => {
        disclosure.open = shouldOpen;
        disclosure.style.height = '';
        disclosure.style.overflow = '';
        disclosure.removeAttribute('data-closing');
        animation = null;
      };

      animation.oncancel = () => {
        disclosure.style.height = '';
        disclosure.style.overflow = '';
        disclosure.removeAttribute('data-closing');
      };
    });
  };

  const parseRoute = (requestedRoute = '') => {
    const [requestedPage, requestedSection] = requestedRoute.replace(/^#/, '').split('/');
    const pageName = pages.some((page) => page.dataset.page === requestedPage) ? requestedPage : 'home';
    const sectionNavigation = sectionNavigations[pageName];
    const sectionName = sectionNavigation?.validSections.has(requestedSection)
      ? requestedSection
      : null;

    return { pageName, sectionName };
  };

  const scrollToSection = (target, behavior) => {
    if (!target) return;

    if (window.innerWidth <= 767) {
      const targetTop = target.getBoundingClientRect().top + window.scrollY - 82;
      window.scrollTo({ top: Math.max(0, targetTop), behavior });
      return;
    }

    if (main) {
      const targetTop = target.getBoundingClientRect().top
        - main.getBoundingClientRect().top
        + main.scrollTop
        - 26;
      main.scrollTo({ top: Math.max(0, targetTop), behavior });
    }
  };

  const renderProjectSphere = () => {
    projectSphereFrame = 0;
    if (!projectSphere || !projectFields.length) return;

    const hasKeyboardFocus = Boolean(focusedProjectField);
    const pointerIsActive = projectSpherePointer.active && pointerQuery.matches && !hasKeyboardFocus;
    const focusX = hasKeyboardFocus
      ? Number(focusedProjectField.dataset.sphereX)
      : pointerIsActive ? projectSpherePointer.x : 0.5;
    const focusY = hasKeyboardFocus
      ? Number(focusedProjectField.dataset.sphereY)
      : pointerIsActive ? projectSpherePointer.y : 0.5;
    const hasFocus = pointerIsActive || hasKeyboardFocus;

    projectSphere.classList.toggle('is-pointer-active', hasFocus);
    projectSphere.style.setProperty('--sphere-pointer-x', `${focusX * 100}%`);
    projectSphere.style.setProperty('--sphere-pointer-y', `${focusY * 100}%`);
    projectSphere.style.setProperty('--sphere-rotate-x', `${(0.5 - focusY) * 6}deg`);
    projectSphere.style.setProperty('--sphere-rotate-y', `${(focusX - 0.5) * 7}deg`);

    const fieldStates = projectFields.map((field) => {
      const x = Number(field.dataset.sphereX);
      const y = Number(field.dataset.sphereY);
      const depth = Number(field.dataset.sphereDepth);
      const distance = Math.hypot(x - focusX, y - focusY);
      return { field, x, y, depth, distance };
    });
    const nearestField = hasFocus
      ? fieldStates.reduce((nearest, state) => state.distance < nearest.distance ? state : nearest)
      : null;

    fieldStates.forEach((state) => {
      let influence = 0;
      if (hasFocus) {
        influence = Math.max(0, 1 - state.distance / 0.5);
        influence *= influence;
        if (state === nearestField) influence = Math.max(0.72, influence);
      }

      const scale = hasFocus
        ? 0.86 + state.depth * 0.08 + influence * 0.22
        : 0.96 + state.depth * 0.04;
      const opacity = hasFocus
        ? Math.min(1, 0.38 + state.depth * 0.2 + influence * 0.54)
        : 0.84 + state.depth * 0.16;
      const blur = hasFocus
        ? Math.max(0, (1 - influence) * 1.35 - state.depth * 0.28)
        : 0;
      const shiftX = hasFocus ? (0.5 - state.x) * influence * 30 : 0;
      const shiftY = hasFocus ? (0.5 - state.y) * influence * 24 : 0;
      const layer = Math.round(state.depth * 20 + influence * 100);

      state.field.classList.toggle('is-field-active', state === nearestField);
      state.field.classList.toggle('is-field-muted', hasFocus && state !== nearestField);

      state.field.style.setProperty('--field-scale', scale.toFixed(3));
      state.field.style.setProperty('--field-opacity', opacity.toFixed(3));
      state.field.style.setProperty('--field-blur', `${blur.toFixed(2)}px`);
      state.field.style.setProperty('--field-shift-x', `${shiftX.toFixed(2)}px`);
      state.field.style.setProperty('--field-shift-y', `${shiftY.toFixed(2)}px`);
      state.field.style.setProperty('--field-z', String(layer));
    });
  };

  const scheduleProjectSphereRender = () => {
    if (projectSphereFrame) return;
    projectSphereFrame = requestAnimationFrame(renderProjectSphere);
  };

  const updateProjectSpherePointer = (event) => {
    if (!projectSphere || event.pointerType !== 'mouse' || !pointerQuery.matches) return;
    projectSphereRect ??= projectSphere.getBoundingClientRect();
    if (!projectSphereRect.width || !projectSphereRect.height) return;

    projectSpherePointer.x = Math.min(1, Math.max(0, (event.clientX - projectSphereRect.left) / projectSphereRect.width));
    projectSpherePointer.y = Math.min(1, Math.max(0, (event.clientY - projectSphereRect.top) / projectSphereRect.height));
    projectSpherePointer.active = true;
    scheduleProjectSphereRender();
  };

  const resetProjectSpherePointer = () => {
    projectSpherePointer.active = false;
    projectSphereRect = null;
    scheduleProjectSphereRender();
  };

  const setSidebarSubmenuVisibility = (submenu, isVisible, animate = true) => {
    if (!submenu) return;

    const activeAnimation = sidebarSubmenuAnimations.get(submenu);
    activeAnimation?.cancel();
    sidebarSubmenuAnimations.delete(submenu);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduceMotion || typeof submenu.animate !== 'function') {
      submenu.hidden = !isVisible;
      submenu.style.height = '';
      submenu.style.overflow = '';
      submenu.style.opacity = '';
      submenu.style.transform = '';
      return;
    }

    if (isVisible) {
      if (!submenu.hidden) return;

      submenu.hidden = false;
      submenu.style.height = '0px';
      submenu.style.overflow = 'hidden';
      submenu.style.opacity = '0';
      submenu.style.transform = 'translateY(-0.35rem)';

      const targetHeight = submenu.scrollHeight;
      const animation = submenu.animate(
        {
          height: ['0px', `${targetHeight}px`],
          opacity: [0, 1],
          transform: ['translateY(-0.35rem)', 'translateY(0)'],
        },
        { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      sidebarSubmenuAnimations.set(submenu, animation);
      animation.onfinish = () => {
        if (sidebarSubmenuAnimations.get(submenu) !== animation) return;
        submenu.style.height = '';
        submenu.style.overflow = '';
        submenu.style.opacity = '';
        submenu.style.transform = '';
        sidebarSubmenuAnimations.delete(submenu);
      };
      return;
    }

    if (submenu.hidden) return;

    const startHeight = submenu.offsetHeight;
    submenu.style.height = `${startHeight}px`;
    submenu.style.overflow = 'hidden';
    const animation = submenu.animate(
      {
        height: [`${startHeight}px`, '0px'],
        opacity: [1, 0],
        transform: ['translateY(0)', 'translateY(-0.35rem)'],
      },
      { duration: 190, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    );
    sidebarSubmenuAnimations.set(submenu, animation);
    animation.onfinish = () => {
      if (sidebarSubmenuAnimations.get(submenu) !== animation) return;
      submenu.hidden = true;
      submenu.style.height = '';
      submenu.style.overflow = '';
      submenu.style.opacity = '';
      submenu.style.transform = '';
      sidebarSubmenuAnimations.delete(submenu);
    };
  };

  const showPage = (requestedRoute, shouldFocus = false, options = {}) => {
    const { deferSectionScroll = false, initial = false } = options;
    const { pageName, sectionName } = parseRoute(requestedRoute);
    const activePageName = pages.find((page) => !page.hidden)?.dataset.page;
    const isSamePageSectionNavigation = Boolean(
      sectionName && activePageName === pageName
    );

    pages.forEach((page) => {
      const isActive = page.dataset.page === pageName;
      page.hidden = !isActive;
      page.classList.toggle('is-active', isActive);
    });

    pageLinks.forEach((link) => {
      const isActive = link.dataset.pageLink === pageName;
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    Object.entries(sectionNavigations).forEach(([parentPage, navigation]) => {
      const isParentActive = pageName === parentPage;
      setSidebarSubmenuVisibility(navigation.submenu, isParentActive, !initial);
      navigation.navLink?.setAttribute('aria-expanded', String(isParentActive));
      navigation.links.forEach((link) => {
        const isCurrent = isParentActive && link.dataset[navigation.dataKey] === sectionName;
        if (isCurrent) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    });

    journeyTimelineStops.forEach((stop) => stop.removeAttribute('aria-current'));
    if (pageName !== 'projects') {
      projectMapButtons.forEach((button) => button.removeAttribute('aria-current'));
      resetProjectSpherePointer();
    }

    if (!isSamePageSectionNavigation) {
      if (main) main.scrollTop = 0;
      window.scrollTo(0, 0);
    }
    setMenu(false);

    if (sectionName && !deferSectionScroll) {
      const target = document.getElementById(`${pageName}-${sectionName}`);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const behavior = shouldFocus && isSamePageSectionNavigation && !reduceMotion
            ? 'smooth'
            : 'auto';
          scrollToSection(target, behavior);
          if (shouldFocus) target?.focus({ preventScroll: true });
        });
      });
    } else if (shouldFocus) {
      main?.focus({ preventScroll: true });
    }

    return { pageName, sectionName, isSamePageSectionNavigation };
  };

  const navigateToRoute = async (requestedRoute, shouldFocus = false, options = {}) => {
    const { initial = false } = options;
    const { pageName, sectionName } = parseRoute(requestedRoute);
    const activePageName = pages.find((page) => !page.hidden)?.dataset.page;
    const loaderAlreadyVisible = body.classList.contains('page-is-loading');

    if (initial || (activePageName === pageName && !loaderAlreadyVisible)) {
      if (activeNavigationController) {
        activeNavigationController.abort();
        activeNavigationController = null;
        pageLoadGeneration += 1;
      }
      showPage(requestedRoute, shouldFocus);
      return;
    }

    activeNavigationController?.abort();
    const controller = new AbortController();
    activeNavigationController = controller;
    const generation = pageLoadGeneration += 1;

    const assetWait = Promise.race([
      waitForPageAssets(pageName, controller.signal),
      waitForDelay(12000, controller.signal),
    ]);

    if (!loaderAlreadyVisible) {
      const readiness = await Promise.race([
        assetWait.then(() => 'ready'),
        waitForDelay(loaderGracePeriod, controller.signal).then(() => 'slow'),
      ]);

      if (controller.signal.aborted || generation !== pageLoadGeneration) return;
      if (readiness === 'ready') {
        activeNavigationController = null;
        showPage(requestedRoute, shouldFocus);
        return;
      }
    }

    beginPageLoading();
    showPage(requestedRoute, false, { deferSectionScroll: Boolean(sectionName) });

    const elapsedLoaderTime = loaderAlreadyVisible && pageLoaderStartedAt
      ? performance.now() - pageLoaderStartedAt
      : 0;
    const remainingLoaderTime = Math.max(0, loaderMinimumVisible - elapsedLoaderTime);
    const waits = [assetWait, waitForDelay(remainingLoaderTime, controller.signal)];

    await Promise.all(waits);
    if (controller.signal.aborted || generation !== pageLoadGeneration) return;

    activeNavigationController = null;
    finishPageLoading();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = sectionName
          ? document.getElementById(`${pageName}-${sectionName}`)
          : null;
        if (target) scrollToSection(target, 'auto');
        if (shouldFocus) (target ?? main)?.focus({ preventScroll: true });
      });
    });
  };

  pageLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const pageName = link.dataset.pageLink;
      if (window.location.hash !== `#${pageName}`) history.pushState(null, '', `#${pageName}`);
      void navigateToRoute(pageName, true);
    });
  });

  Object.entries(sectionNavigations).forEach(([parentPage, navigation]) => {
    navigation.links.forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const sectionName = link.dataset[navigation.dataKey];
        const route = `${parentPage}/${sectionName}`;
        if (window.location.hash !== `#${route}`) history.pushState(null, '', `#${route}`);
        void navigateToRoute(route, true);
      });
    });
  });

  researchProjectDisclosures.forEach(animateResearchDisclosure);

  journeyTimelineStops.forEach((stop) => {
    stop.addEventListener('click', () => {
      const target = document.getElementById(stop.dataset.timelineTarget);
      if (!target) return;

      journeyTimelineStops.forEach((candidate) => {
        if (candidate === stop) candidate.setAttribute('aria-current', 'location');
        else candidate.removeAttribute('aria-current');
      });

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollToSection(target, reduceMotion ? 'auto' : 'smooth');
      target.focus({ preventScroll: true });

      document.querySelectorAll('.is-timeline-target').forEach((activeTarget) => {
        activeTarget.classList.remove('is-timeline-target');
      });
      target.classList.add('is-timeline-target');
      window.clearTimeout(timelineTargetTimer);
      timelineTargetTimer = window.setTimeout(() => {
        target.classList.remove('is-timeline-target');
      }, 1300);
    });
  });

  projectSphere?.addEventListener('pointerenter', updateProjectSpherePointer, { passive: true });
  projectSphere?.addEventListener('pointermove', updateProjectSpherePointer, { passive: true });
  projectSphere?.addEventListener('pointerleave', resetProjectSpherePointer, { passive: true });
  projectSphere?.addEventListener('pointercancel', resetProjectSpherePointer, { passive: true });
  projectSphere?.addEventListener('focusin', (event) => {
    focusedProjectField = event.target.closest('[data-project-field]');
    scheduleProjectSphereRender();
  });
  projectSphere?.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      focusedProjectField = document.activeElement?.closest?.('[data-project-field]') ?? null;
      scheduleProjectSphereRender();
    });
  });

  projectMapButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.projectTarget);
      if (!target) return;

      projectMapButtons.forEach((candidate) => {
        if (candidate === button) candidate.setAttribute('aria-current', 'location');
        else candidate.removeAttribute('aria-current');
      });

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollToSection(target, reduceMotion ? 'auto' : 'smooth');
      target.focus({ preventScroll: true });
      document.querySelectorAll('.is-project-map-target').forEach((activeTarget) => {
        activeTarget.classList.remove('is-project-map-target');
      });
      target.classList.add('is-project-map-target');
      window.clearTimeout(projectMapTargetTimer);
      projectMapTargetTimer = window.setTimeout(() => {
        target.classList.remove('is-project-map-target');
      }, 1300);
    });
  });

  menuToggle?.addEventListener('click', () => {
    setMenu(!body.classList.contains('nav-open'));
  });

  sidebarPanel?.addEventListener('pointerenter', startPointerWake, { passive: true });
  sidebarPanel?.addEventListener('pointermove', updatePointerWake, { passive: true });
  sidebarPanel?.addEventListener('pointerleave', stopPointerWake, { passive: true });
  sidebarPanel?.addEventListener('pointercancel', stopPointerWake, { passive: true });

  skipLink?.addEventListener('click', (event) => {
    event.preventDefault();
    main?.focus({ preventScroll: false });
  });

  themeToggle?.addEventListener('click', () => {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = nextTheme;
    setThemeButtonLabel();
    try {
      localStorage.setItem('kabir-theme', nextTheme);
    } catch (error) {
      // The selected theme still applies for this visit when storage is unavailable.
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('nav-open')) {
      setMenu(false);
      menuToggle?.focus();
    }
  });

  window.addEventListener('popstate', () => {
    void navigateToRoute(window.location.hash.slice(1));
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 767) setMenu(false);
    if (!canTrackPointer()) stopPointerWake();
    projectSphereRect = null;
    scheduleProjectSphereRender();
    resizeWater();
  });
  window.addEventListener('blur', stopPointerWake);
  window.addEventListener('pagehide', () => {
    activeNavigationController?.abort();
    activeNavigationController = null;
    pageLoadGeneration += 1;
    if (body.classList.contains('page-is-loading')) finishPageLoading();
    stopPointerWake();
    stopWater();
  });
  window.addEventListener('pageshow', resizeWater);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPointerWake();
      stopWater();
    } else {
      resizeWater();
    }
  });
  pointerQuery.addEventListener?.('change', stopPointerWake);

  waterDepthCanvas?.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    waterContextLost = true;
    waterRenderer = null;
    lastCausticFrame = 0;
    waterDepthCanvas.classList.remove('is-caustic-ready');
    waterDepthCanvas.classList.add('is-context-lost');
  });

  waterDepthCanvas?.addEventListener('webglcontextrestored', () => {
    waterContextLost = false;
    depthContext = null;
    waterDepthInitialized = false;
    waterDepthPixelRatio = 0;
    waterDepthCanvas.classList.remove('is-context-lost');
    initializeWaterDepth();
    resizeWater();
  });

  if (typeof ResizeObserver === 'function' && sidebarPanel) {
    new ResizeObserver(resizeWater).observe(sidebarPanel);
  }

  currentYears.forEach((currentYear) => {
    currentYear.textContent = String(new Date().getFullYear());
  });
  setThemeButtonLabel();
  void navigateToRoute(window.location.hash.slice(1), false, { initial: true });
  renderProjectSphere();
  initializeWaterDepth();
  resizeWater();
})();
