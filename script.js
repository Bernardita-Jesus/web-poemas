let uploadedImages = [];
let mosaicCanvas = null;

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
    const scale = Math.max(WORK_DIM / img.width, WORK_DIM / img.height);
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

    // Build a single numeric sort key per mode, then blend in noise scaled
    // to that key's range. 0% jitter = strict sort, 100% = near shuffle.
    tiles.forEach(t => {
      let key;
      if (mode === 'hue') key = t.h_; // 0..360
      else if (mode === 'brightness') key = (1 - t.bri) * 360; // flip so low = bright, scale to 360
      else if (mode === 'saturation') key = (1 - t.s) * 360;
      else key = t.h_ + t.bri * 40; // hue-bright, small brightness nudge

      const noise = (Math.random() - 0.5) * jitterAmount * 480; // up to ~±240 at max
      t.sortKey = key + noise;
    });

    tiles.sort((a, b) => a.sortKey - b.sortKey);

    processBtn.textContent = 'Dibujando…';
    const finish = () => {
      imgCount.textContent = tiles.length + ' recortes armados.';
      processBtn.disabled = false;
      processBtn.textContent = 'Armar mosaico';
      downloadBtn.disabled = false;
    };

    if (variable) {
      renderFlowMosaic(tiles, rowHeight, minWidth, maxWidth, finish);
    } else {
      renderFixedMosaic(tiles, tileW, tileH, finish);
    }
  }

  processStep();
}

function renderFixedMosaic(tiles, tileW, tileH, onDone) {
  const n = tiles.length;
  // Aim for a roughly square overall canvas even though each tile is a wide rectangle.
  const rows = Math.ceil(Math.sqrt(n * (tileW / tileH)));
  const cols = Math.ceil(n / rows);

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
    const end = Math.min(i + BATCH, n);
    for (; i < end; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.putImageData(tiles[i].imgData, col * tileW, row * tileH);
    }
    if (i < n) {
      setTimeout(drawStep, 0);
    } else if (onDone) {
      onDone();
    }
  }
  drawStep();
}

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