let uploadedImages = [];
let mosaicCanvas = null;

// Recortes ya calculados (color, brillo, imgData) del último mosaico armado,
// y el layout con el que se dibujaron — se guardan para poder reordenar
// (botones "Ordenar por brillo" / "Aleatorizar") sin repetir todo el
// procesamiento de imágenes, que es la parte lenta.
let currentTiles = [];
let currentLayout = null;

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const thumbrow = document.getElementById('thumbrow');
const imgCount = document.getElementById('imgCount');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const tileWSlider = document.getElementById('tileW');
const tileWVal = document.getElementById('tileWVal');
const tileHSlider = document.getElementById('tileH');
const tileHVal = document.getElementById('tileHVal');
const variableSizesCheckbox = document.getElementById('variableSizes');
const fixedSizeControls = document.getElementById('fixedSizeControls');
const variableSizeControls = document.getElementById('variableSizeControls');
const rowHeightSlider = document.getElementById('rowHeight');
const rowHeightVal = document.getElementById('rowHeightVal');
const minWidthSlider = document.getElementById('minWidth');
const minWidthVal = document.getElementById('minWidthVal');
const maxWidthSlider = document.getElementById('maxWidth');
const maxWidthVal = document.getElementById('maxWidthVal');
const sortMode = document.getElementById('sortMode');
const jitterSlider = document.getElementById('jitter');
const jitterVal = document.getElementById('jitterVal');
const sortBrightnessBtn = document.getElementById('sortBrightnessBtn');
const shuffleBtn = document.getElementById('shuffleBtn');

variableSizesCheckbox.addEventListener('change', () => {
  const on = variableSizesCheckbox.checked;
  fixedSizeControls.style.display = on ? 'none' : '';
  variableSizeControls.style.display = on ? '' : 'none';
});
rowHeightSlider.addEventListener('input', () => {
  rowHeightVal.textContent = rowHeightSlider.value;
});
minWidthSlider.addEventListener('input', () => {
  minWidthVal.textContent = minWidthSlider.value;
  if (parseInt(minWidthSlider.value, 10) >= parseInt(maxWidthSlider.value, 10)) {
    maxWidthSlider.value = Math.min(300, parseInt(minWidthSlider.value, 10) + 20);
    maxWidthVal.textContent = maxWidthSlider.value;
  }
});
maxWidthSlider.addEventListener('input', () => {
  maxWidthVal.textContent = maxWidthSlider.value;
  if (parseInt(maxWidthSlider.value, 10) <= parseInt(minWidthSlider.value, 10)) {
    minWidthSlider.value = Math.max(20, parseInt(maxWidthSlider.value, 10) - 20);
    minWidthVal.textContent = minWidthSlider.value;
  }
});

tileWSlider.addEventListener('input', () => {
  tileWVal.textContent = tileWSlider.value;
});
tileHSlider.addEventListener('input', () => {
  tileHVal.textContent = tileHSlider.value;
});
jitterSlider.addEventListener('input', () => {
  jitterVal.textContent = jitterSlider.value;
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (files.length === 0 && fileList.length > 0) {
    imgCount.textContent = 'Ese archivo no es una imagen soportada.';
    return;
  }
  files.forEach(file => {
    const reader = new FileReader();
    reader.onerror = () => {
      imgCount.textContent = 'No se pudo leer "' + file.name + '".';
    };
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => {
        imgCount.textContent = '"' + file.name + '" no se pudo abrir (formato no soportado, probá con JPG o PNG).';
      };
      img.onload = () => {
        uploadedImages.push(img);
        const t = document.createElement('img');
        t.src = ev.target.result;
        thumbrow.appendChild(t);
        updateCount();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateCount() {
  imgCount.textContent = uploadedImages.length + (uploadedImages.length === 1 ? ' imagen cargada' : ' imágenes cargadas');
  processBtn.disabled = uploadedImages.length === 0;
}

processBtn.addEventListener('click', buildMosaic);
downloadBtn.addEventListener('click', () => {
  if (!mosaicCanvas) return;
  const link = document.createElement('a');
  link.download = 'mosaico-color.png';
  link.href = mosaicCanvas.toDataURL('image/png');
  link.click();
});

function rgbToHsb(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const bri = max;
  return { h, s, bri };
}

// Resolución de trabajo: más alta que antes para no perder nitidez en los recortes.
const WORK_DIM = 960;

// Factor de zoom aplicado antes de recortar: en vez de usar la foto completa
// (encuadre "cover"), recorta una región más chica y centrada, así cada
// pieza del mosaico muestra un detalle de más cerca en vez de la escena entera.
const ZOOM = 1.35;

function planFixedGrid(colsUnits, rowsUnits) {
  // one tile per cell — trivial "plan" for the fixed-size mode
  const plan = [];
  for (let gy = 0; gy < rowsUnits; gy++) {
    for (let gx = 0; gx < colsUnits; gx++) {
      plan.push({ gx, gy, size: 1 });
    }
  }
  return plan;
}

function planVariableWidths(size, rowHeight, minW, maxW) {
  // Fills a size x size square in horizontal rows of fixed height `rowHeight`.
  // Within each row, tile widths are picked at random from [min, mid, max],
  // always leaving either 0 or at least minW of remaining space so no sliver
  // tiles appear — the very last tile in a row just fills whatever is left.
  const widthOptions = [minW, Math.round((minW + maxW) / 2), maxW];
  const plan = [];
  let y = 0;
  while (y < size) {
    const h = Math.min(rowHeight, size - y);
    let x = 0;
    while (x < size) {
      const remaining = size - x;
      let w;
      if (remaining <= maxW) {
        w = remaining;
      } else {
        const candidates = widthOptions.filter(o => remaining - o === 0 || remaining - o >= minW);
        w = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : minW;
      }
      plan.push({ x, y, w, h });
      x += w;
    }
    y += rowHeight;
  }
  return plan;
}

function buildMosaic() {
  if (uploadedImages.length === 0) {
    imgCount.textContent = 'Subí al menos una foto primero.';
    return;
  }
  processBtn.disabled = true;
  processBtn.textContent = 'Procesando… 0%';

  const variable = variableSizesCheckbox.checked;
  const rowHeight = parseInt(rowHeightSlider.value, 10);
  const minWidth = parseInt(minWidthSlider.value, 10);
  const maxWidth = parseInt(maxWidthSlider.value, 10);
  const tileW = parseInt(tileWSlider.value, 10);
  const tileH = parseInt(tileHSlider.value, 10);

  // Pre-render each uploaded photo onto its own normalized square canvas at full working resolution.
  const normalized = uploadedImages.map(img => {
    const c = document.createElement('canvas');
    c.width = WORK_DIM;
    c.height = WORK_DIM;
    const cx = c.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(WORK_DIM / img.width, WORK_DIM / img.height) * ZOOM;
    const sw = WORK_DIM / scale, sh = WORK_DIM / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, WORK_DIM, WORK_DIM);
    return cx;
  });

  const colsUnits = Math.floor(WORK_DIM / tileW);
  const rowsUnits = Math.floor(WORK_DIM / tileH);

  const jobs = [];
  normalized.forEach((cx, imgIdx) => {
    if (variable) {
      const plan = planVariableWidths(WORK_DIM, rowHeight, minWidth, maxWidth);
      plan.forEach(p => {
        jobs.push({ imgIdx, px: p.x, py: p.y, w: p.w, h: p.h });
      });
    } else {
      const plan = planFixedGrid(colsUnits, rowsUnits);
      plan.forEach(p => {
        jobs.push({ imgIdx, px: p.gx * tileW, py: p.gy * tileH, w: tileW, h: tileH });
      });
    }
  });

  const totalTiles = jobs.length;

  // 1x1 scratch canvas: drawing a region scaled down to a single pixel
  // makes the browser do the color averaging for us, no manual pixel loop.
  const avgCanvas = document.createElement('canvas');
  avgCanvas.width = 1;
  avgCanvas.height = 1;
  const actx = avgCanvas.getContext('2d', { willReadFrequently: true });

  const tiles = [];
  let cursor = 0;
  const BATCH = 25; // small enough per tick to never look like a runaway loop

  function processStep() {
    try {
      const end = Math.min(cursor + BATCH, totalTiles);
      for (let k = cursor; k < end; k++) {
        const job = jobs[k];
        const cx = normalized[job.imgIdx];

        actx.clearRect(0, 0, 1, 1);
        actx.drawImage(cx.canvas, job.px, job.py, job.w, job.h, 0, 0, 1, 1);
        const avg = actx.getImageData(0, 0, 1, 1).data;
        const hsb = rgbToHsb(avg[0], avg[1], avg[2]);
        const tileData = cx.getImageData(job.px, job.py, job.w, job.h);
        tiles.push({ imgData: tileData, w: job.w, h: job.h, h_: hsb.h, s: hsb.s, bri: hsb.bri });
      }
      cursor = end;
      processBtn.textContent = 'Procesando… ' + Math.round((cursor / totalTiles) * 100) + '%';

      if (cursor < totalTiles) {
        setTimeout(processStep, 0);
      } else {
        sortAndRender();
      }
    } catch (err) {
      console.error(err);
      imgCount.textContent = 'Ups, falló: ' + err.message;
      processBtn.disabled = false;
      processBtn.textContent = 'Armar mosaico';
    }
  }

  function sortAndRender() {
    const mode = sortMode.value;
    const jitterAmount = parseInt(jitterSlider.value, 10) / 100; // 0..1
    applySort(tiles, mode, jitterAmount);

    currentTiles = tiles;
    currentLayout = { variable, tileW, tileH, rowHeight, minWidth, maxWidth };

    processBtn.textContent = 'Dibujando…';
    const finish = () => {
      imgCount.textContent = tiles.length + ' recortes armados.';
      processBtn.disabled = false;
      processBtn.textContent = 'Armar mosaico';
      downloadBtn.disabled = false;
    };

    renderCurrentTiles(finish);
  }

  processStep();
}

// Calcula una clave numérica de orden por recorte según el modo, y le suma
// ruido proporcional a `jitterAmount` (0 = orden estricto, 1 ≈ mezcla total).
// Se usa tanto al armar el mosaico por primera vez como al reordenar con los
// botones flotantes.
function applySort(tilesArr, mode, jitterAmount) {
  if (mode === 'shuffle') {
    for (let i = tilesArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tilesArr[i], tilesArr[j]] = [tilesArr[j], tilesArr[i]];
    }
    return;
  }
  tilesArr.forEach(t => {
    let key;
    if (mode === 'hue') key = t.h_; // 0..360
    else if (mode === 'brightness') key = (1 - t.bri) * 360; // flip so low = bright, scale to 360
    else if (mode === 'saturation') key = (1 - t.s) * 360;
    else key = t.h_ + t.bri * 40; // hue-bright, small brightness nudge

    const noise = (Math.random() - 0.5) * jitterAmount * 480; // up to ~±240 at max
    t.sortKey = key + noise;
  });
  tilesArr.sort((a, b) => a.sortKey - b.sortKey);
}

function renderCurrentTiles(onDone) {
  const { variable, tileW, tileH, rowHeight, minWidth, maxWidth } = currentLayout;
  if (variable) {
    renderFlowMosaic(currentTiles, rowHeight, minWidth, maxWidth, onDone);
  } else {
    renderFixedMosaic(currentTiles, tileW, tileH, onDone);
  }
}

sortBrightnessBtn.addEventListener('click', () => {
  if (currentTiles.length === 0) return;
  applySort(currentTiles, 'brightness', 0);
  renderCurrentTiles(() => {
    imgCount.textContent = currentTiles.length + ' recortes armados.';
  });
});

shuffleBtn.addEventListener('click', () => {
  if (currentTiles.length === 0) return;
  applySort(currentTiles, 'shuffle', 0);
  renderCurrentTiles(() => {
    imgCount.textContent = currentTiles.length + ' recortes armados.';
  });
});

function renderFixedMosaic(tiles, tileW, tileH, onDone) {
  const n = tiles.length;
  // Ancho fijo (pensado para pantalla); las filas necesarias se apilan hacia
  // abajo según cuántos recortes haya, así una mayor densidad de recortes
  // se traduce en una página más larga en vez de un mosaico más cuadrado.
  const TARGET_WIDTH = 1600;
  const cols = Math.max(1, Math.round(TARGET_WIDTH / tileW));
  const rows = Math.ceil(n / cols);
  const total = rows * cols; // may be > n; leftover cells recycle tiles below so no cell is left blank

  const holder = document.getElementById('canvas-holder');
  holder.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.width = cols * tileW;
  canvas.height = rows * tileH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  holder.appendChild(canvas);
  mosaicCanvas = canvas;

  let i = 0;
  const BATCH = 80;

  function drawStep() {
    const end = Math.min(i + BATCH, total);
    for (; i < end; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.putImageData(tiles[i % n].imgData, col * tileW, row * tileH);
    }
    if (i < total) {
      setTimeout(drawStep, 0);
    } else if (onDone) {
      onDone();
    }
  }
  drawStep();
}

// ---------------------------------------------------------------------
// Carga automática de fondo: en "modo fondo de home" el panel de
// controles está oculto (ver style.css), así que en vez de esperar a
// que alguien arrastre fotos, cargamos directamente las imágenes que
// están en assets/imagenes y armamos el mosaico apenas terminan de
// cargar. Si sumás o sacás fotos de esa carpeta, actualizá esta lista.
// ---------------------------------------------------------------------
const ASSET_IMAGE_PATHS = [
  'assets/imagenes/otono-07.jpg',
  'assets/imagenes/otono-08.jpg',
  'assets/imagenes/otono-09.jpg',
  'assets/imagenes/otono-10.jpeg',
  'assets/imagenes/otono-11.jpeg',
  'assets/imagenes/otono-12.jpeg',
];

function loadAssetBackground() {
  let settled = 0;
  ASSET_IMAGE_PATHS.forEach(path => {
    const img = new Image();
    const onSettle = () => {
      settled++;
      updateCount();
      if (settled === ASSET_IMAGE_PATHS.length && uploadedImages.length > 0) {
        buildMosaic();
      }
    };
    img.onload = () => {
      uploadedImages.push(img);
      const t = document.createElement('img');
      t.src = path;
      thumbrow.appendChild(t);
      onSettle();
    };
    img.onerror = () => {
      console.error('No se pudo cargar la imagen de fondo:', path);
      onSettle();
    };
    img.src = path;
  });
}

loadAssetBackground();

// ---------------------------------------------------------------------
// Poema flotante: carga los poemas de la estación actual desde su YAML
// (assets/poemas/<estacion>.yaml) y los va mostrando en loop, arriba a
// la izquierda, como una pila de frases, cada una con su propio
// destacado (recuadro blanco ajustado al texto, no una tarjeta única).
// Las frases se escriben en cascada: cada una aparece palabra por
// palabra y recién cuando termina empieza a escribirse la siguiente.
// Cuando el poema completo terminó de escribirse, se borra y, tras una
// pausa, empieza a escribirse otro (sin repetir el que se acaba de ver).
// ---------------------------------------------------------------------
const CURRENT_SEASON = 'otono';
const poemCard = document.getElementById('poemCard');
const WORD_STEP_MS = 55;
const WORD_REVEAL_MS = 350; // debe coincidir con la duración de la animación .word-in en CSS
const PAUSE_BETWEEN_FRASES_MS = 260;
const PAUSE_BETWEEN_POEMS_MS = 5000;

let seasonPoems = [];
let lastPoemIndex = -1;

// Escribe el poema y devuelve cuánto tarda (ms) en quedar completamente visible.
function renderPoem(poem) {
  poemCard.innerHTML = '';

  const frases = [];
  if (poem.titulo) frases.push({ text: poem.titulo, titulo: true });
  (poem.texto || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => frases.push({ text: line, titulo: false }));

  let cumulativeMs = 0;
  frases.forEach((frase, i) => {
    const wrap = document.createElement('span');
    wrap.className = 'frase' + (frase.titulo ? ' frase-titulo' : '');
    wrap.style.animationDelay = cumulativeMs + 'ms';

    const words = frase.text.split(' ');
    words.forEach((word, idx) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word;
      span.style.animationDelay = (cumulativeMs + idx * WORD_STEP_MS) + 'ms';
      wrap.appendChild(span);
      if (idx < words.length - 1) wrap.appendChild(document.createTextNode(' '));
    });

    poemCard.appendChild(wrap);
    cumulativeMs += words.length * WORD_STEP_MS;
    if (i < frases.length - 1) cumulativeMs += PAUSE_BETWEEN_FRASES_MS;
  });

  return cumulativeMs + WORD_REVEAL_MS;
}

function pickNextPoemIndex() {
  if (seasonPoems.length <= 1) return 0;
  let idx;
  do {
    idx = Math.floor(Math.random() * seasonPoems.length);
  } while (idx === lastPoemIndex);
  return idx;
}

function playNextPoem() {
  if (seasonPoems.length === 0) return;
  lastPoemIndex = pickNextPoemIndex();
  const durationMs = renderPoem(seasonPoems[lastPoemIndex]);
  // Al terminar de escribirse, el poema se queda visible un rato antes de
  // borrarse y dar paso al siguiente.
  setTimeout(() => {
    poemCard.innerHTML = '';
    playNextPoem();
  }, durationMs + PAUSE_BETWEEN_POEMS_MS);
}

function loadSeasonPoem(season) {
  if (!poemCard || typeof jsyaml === 'undefined') return;
  fetch('assets/poemas/' + season + '.yaml')
    .then(res => res.text())
    .then(yamlText => {
      const poems = jsyaml.load(yamlText);
      if (!Array.isArray(poems) || poems.length === 0) return;
      seasonPoems = poems;
      playNextPoem();
    })
    .catch(err => console.error('No se pudo cargar el poema:', err));
}

loadSeasonPoem(CURRENT_SEASON);

function renderFlowMosaic(tiles, rowHeight, minWidth, maxWidth, onDone) {
  // Fixed-height row flow: tiles keep whatever width they were extracted at
  // (already between minWidth and maxWidth) and simply wrap to a new row
  // once the current row would overflow the target canvas width.
  const n = tiles.length;
  const avgWidth = (minWidth + maxWidth) / 2;
  const targetWidth = Math.max(WORK_DIM, Math.round(Math.sqrt(n * avgWidth * rowHeight)));

  let x = 0, y = 0;
  const placements = [];
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    if (x > 0 && x + t.w > targetWidth) {
      x = 0;
      y += rowHeight;
    }
    placements.push({ x, y, tile: t });
    x += t.w;
  }
  const canvasHeight = y + rowHeight;

  const holder = document.getElementById('canvas-holder');
  holder.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffdf3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  holder.appendChild(canvas);
  mosaicCanvas = canvas;

  let i = 0;
  const BATCH = 80;
  function drawStep() {
    const end = Math.min(i + BATCH, placements.length);
    for (; i < end; i++) {
      const p = placements[i];
      ctx.putImageData(p.tile.imgData, p.x, p.y);
    }
    if (i < placements.length) {
      setTimeout(drawStep, 0);
    } else if (onDone) {
      onDone();
    }
  }
  drawStep();
}