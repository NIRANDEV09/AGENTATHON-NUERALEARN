// NeuraLearn "PDF & Files" Standalone Page Controller
// Features: Local PDF/image rendering, resizable selection rectangle with mouse+touch,
// text/crop extraction, recommended topics, dedicated Whiteboard instance (DocsRenderer/DocsController),
// synchronized captions, notes export, and complete lifecycle cleanup.

(() => {
  const $ = id => document.getElementById(id);
  const DX_PREFIX = 'dx_';

  // --- Dynamic Vendor Loader for PDF.js ---
  let pdfjsLoaded = false;
  async function ensurePdfJs() {
    if (pdfjsLoaded && window.pdfjsLib) return window.pdfjsLib;
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="/vendor/pdf.js"]');
        if (existing) return resolve();
        const s = document.createElement('script');
        s.src = '/vendor/pdf.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load PDF engine.'));
        document.head.appendChild(s);
      });
    }
    if (window.pdfjsLib?.GlobalWorkerOptions) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.js';
    }
    pdfjsLoaded = true;
    return window.pdfjsLib;
  }

  // --- Engine Subclasses ---
  class DocsRenderer extends window.WhiteboardRenderer {
    constructor(svgElement) {
      super(svgElement);
      this.drawnBounds = [];
    }

    initSvg() {
      if (!this.svg) return;
      super.initSvg();
      this.drawnBounds = [];
      const markers = this.svg.querySelectorAll('defs marker');
      markers.forEach(m => {
        const id = m.getAttribute('id');
        if (id && !id.startsWith(DX_PREFIX)) {
          m.setAttribute('id', DX_PREFIX + id);
        }
      });
    }

    clear() {
      this.drawnBounds = [];
      super.clear();
    }

    removeElement(id) {
      this.drawnBounds = this.drawnBounds.filter(b => b.id !== id);
      super.removeElement(id);
    }

    executeAction(action, animated = true) {
      if (!action || typeof action !== 'object') return;
      const op = String(action.op || action.type || 'reveal').toLowerCase();

      // If action is clear, wipe canvas cleanly
      if (op === 'clear') {
        if (action.targetIds) {
          action.targetIds.forEach(tid => this.removeElement(tid));
        } else {
          this.clear();
        }
        return;
      }

      // Check for bounding box collision with previously drawn shapes or headers
      const bbox = this.calcActionBBox(action);
      if (bbox) {
        const colliding = this.findCollidingShape(bbox);
        if (colliding) {
          this.removeElement(colliding.id);
        }
        this.drawnBounds.push({ id: action.id, ...bbox, op });
      }

      super.executeAction(action, animated);
    }

    calcActionBBox(action) {
      const op = String(action.op || action.type || '').toLowerCase();
      if (op === 'draw_rect') {
        const x = this.normalizeX(action.x);
        const y = this.normalizeY(action.y);
        const w = this.normalizeX(action.width || action.w || 80);
        const h = this.normalizeY(action.height || action.h || 50);
        return { minX: x, minY: y, maxX: x + w, maxY: y + h };
      }
      if (op === 'draw_circle') {
        const cx = this.normalizeX(action.cx || action.x);
        const cy = this.normalizeY(action.cy || action.y);
        const r = Number(action.r || action.radius || 20);
        return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
      }
      if (op === 'draw_text' || op === 'draw_formula') {
        const x = this.normalizeX(action.x);
        const y = this.normalizeY(action.y);
        const len = String(action.text || action.label || '').length;
        const fs = Number(action.fontSize) || 18;
        return { minX: x, minY: y - fs, maxX: x + Math.max(60, len * (fs * 0.55)), maxY: y + 6 };
      }
      return null;
    }

    findCollidingShape(newBox) {
      for (let i = this.drawnBounds.length - 1; i >= 0; i--) {
        const existing = this.drawnBounds[i];
        if (!this.elements.has(existing.id)) continue;

        // Header / title collision: if a text is placed in top title area (y <= 120) and another text exists in top area
        if (newBox.op.includes('text') && existing.op.includes('text')) {
          if (newBox.minY <= 120 && existing.minY <= 120) {
            return existing;
          }
          // Same Y line collision with overlapping X
          if (Math.abs(newBox.minY - existing.minY) < 24) {
            const xOverlap = Math.max(0, Math.min(newBox.maxX, existing.maxX) - Math.max(newBox.minX, existing.minX));
            if (xOverlap > 40) return existing;
          }
        }

        // Shape container collision
        if ((newBox.op === 'draw_rect' && existing.op === 'draw_rect') || 
            (newBox.op === 'draw_circle' && existing.op === 'draw_circle')) {
          const xOverlap = Math.max(0, Math.min(newBox.maxX, existing.maxX) - Math.max(newBox.minX, existing.minX));
          const yOverlap = Math.max(0, Math.min(newBox.maxY, existing.maxY) - Math.max(newBox.minY, existing.minY));
          const overlapArea = xOverlap * yOverlap;

          const newArea = (newBox.maxX - newBox.minX) * (newBox.maxY - newBox.minY);
          const existingArea = (existing.maxX - existing.minX) * (existing.maxY - existing.minY);
          const minArea = Math.min(newArea, existingArea);

          if (minArea > 0 && (overlapArea / minArea) > 0.45) {
            return existing;
          }
        }
      }
      return null;
    }

    getArrowMarker(color) {
      const base = super.getArrowMarker(color);
      return base.replace('url(#', `url(#${DX_PREFIX}`);
    }

    setSketchMode(enabled) {
      this.sketchMode = !!enabled;
    }
  }

  class DocsController extends window.WhiteboardPlaybackController {
    constructor(options = {}) {
      super(options);
      this.captionHeading = options.captionHeading;
      this.captionNarration = options.captionNarration;
      this.stepPill = options.stepPill;
      this.stepList = options.stepList;
    }

    renderTranscriptSidebar() {
      if (!this.stepList) return;
      this.stepList.innerHTML = '';
      if (!this.steps || !this.steps.length) return;

      this.steps.forEach((step, idx) => {
        const item = document.createElement('div');
        item.className = 'dx-step-item' + (idx === this.currentIndex ? ' active' : '');
        item.id = `dx_step_item_${idx}`;

        const num = document.createElement('span');
        num.className = 'dx-step-item-num';
        num.textContent = `${idx + 1}`;

        const text = document.createElement('span');
        text.className = 'dx-step-item-text';
        text.textContent = step.heading || `Step ${idx + 1}`;

        item.append(num, text);
        item.addEventListener('click', () => {
          this.seekToStep(idx);
        });
        this.stepList.appendChild(item);
      });
    }

    highlightTranscriptCard(index) {
      const step = this.steps[index];
      if (step) {
        if (this.captionHeading) {
          this.captionHeading.textContent = `${index + 1}. ${step.heading || 'Teaching Step'}`;
        }
        if (this.captionNarration) {
          this.captionNarration.textContent = step.narration || '';
        }
        if (this.stepPill) {
          this.stepPill.textContent = `Step ${index + 1} of ${this.steps.length}`;
        }
      } else if (index === -1) {
        if (this.captionHeading) this.captionHeading.textContent = 'Ready';
        if (this.captionNarration) this.captionNarration.textContent = 'Lesson loaded — press Play or click Teach to begin.';
        if (this.stepPill) this.stepPill.textContent = 'Ready';
      }

      if (this.stepList) {
        const items = this.stepList.querySelectorAll('.dx-step-item');
        items.forEach((it, i) => it.classList.toggle('active', i === index));
        const activeItem = $(`dx_step_item_${index}`);
        if (activeItem) {
          activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else if (this.isPaused) {
        this.resume();
      } else if (this.steps && this.steps.length > 0) {
        if (this.currentIndex >= this.steps.length - 1 && !this.isPlaying) {
          this.seekToStep(0);
        } else {
          this.playStep(this.currentIndex || 0);
        }
      } else {
        startTeaching();
      }
    }

    updateControls() {
      const total = this.steps.length;
      const curr = total > 0 ? this.currentIndex + 1 : 0;

      if (this.playBtn) {
        if (this.isPlaying) {
          this.playBtn.innerHTML = '⏸ Pause';
          this.playBtn.className = 'dx-ctrl-btn warn lg';
          this.playBtn.disabled = false;
        } else if (this.isPaused) {
          this.playBtn.innerHTML = '▶ Resume';
          this.playBtn.className = 'dx-ctrl-btn primary lg';
          this.playBtn.disabled = false;
        } else if (total > 0 && curr >= total) {
          this.playBtn.innerHTML = '↺ Replay';
          this.playBtn.className = 'dx-ctrl-btn primary lg';
          this.playBtn.disabled = false;
        } else {
          this.playBtn.innerHTML = '▶ Teach';
          this.playBtn.className = 'dx-ctrl-btn primary lg';
          this.playBtn.disabled = false;
        }
      }

      if (this.progressEl) {
        this.progressEl.textContent = total > 0 ? `${curr} / ${total}` : '0 / 0';
      }
      if (this.statusEl) {
        if (this.isPlaying) {
          this.statusEl.textContent = `Drawing step ${curr} of ${total}...`;
        } else if (this.isPaused) {
          this.statusEl.textContent = 'Paused';
        } else if (total > 0 && curr >= total) {
          this.statusEl.textContent = 'Lesson complete';
        } else {
          this.statusEl.textContent = 'Ready';
        }
      }
    }
  }

  // --- Session & State Management ---
  let currentSessionId = 0;
  let state = null;
  let docsRenderer = null;
  let docsController = null;
  const topicSuggestionsCache = new Map();

  function createState() {
    currentSessionId++;
    return {
      sessionId: currentSessionId,
      file: null,
      isImage: false,
      pdfDoc: null,
      currentPage: 1,
      totalPages: 1,
      scale: 1.0,
      fitWidth: true,
      currentRenderTask: null,
      sourceWidth: 0,
      sourceHeight: 0,
      pageText: '',
      pageTextItems: [],
      // Normalized selection: 0..1 relative to page width/height
      selection: null, // { x, y, width, height }
      selectedText: '',
      selectedCropB64: null,
      autoCropPic: false,
      docOutlineTopics: [],
      headingScanPromise: null,
      activeFetchController: null,
      topicsAbortController: null,
      topicsDebounceTimer: null
    };
  }

  // --- DOM Elements ---
  const docsView = $('docsView');
  const banner = $('dxBanner');
  const dropzone = $('dxDropzone');
  const fileInput = $('dxFileInput');
  const browseBtn = $('dxBrowseBtn');
  const viewerBox = $('dxViewerBox');
  const docBadge = $('dxDocBadge');
  const prevPageBtn = $('dxPrevPageBtn');
  const nextPageBtn = $('dxNextPageBtn');
  const pageInput = $('dxPageInput');
  const totalPagesEl = $('dxTotalPages');
  const zoomInBtn = $('dxZoomInBtn');
  const zoomOutBtn = $('dxZoomOutBtn');
  const zoomValEl = $('dxZoomVal');
  const fitWidthBtn = $('dxFitWidthBtn');
  const selectWholeBtn = $('dxSelectWholeBtn');
  const clearCropBtn = $('dxClearCropBtn');
  const changeFileBtn = $('dxChangeFileBtn');
  const canvasStage = $('dxCanvasStage');
  const canvasContainer = $('dxCanvasContainer');
  const docCanvas = $('dxDocCanvas');
  const cropOverlay = $('dxCropOverlay');
  const cropBoxEl = $('dxCropBoxEl');
  const cropThumb = $('dxCropThumb');
  const statusText = $('dxStatusText');
  const includeCropCheckbox = $('dxIncludeCropCheckbox');
  const questionInput = $('dxQuestionInput');
  const teachBtn = $('dxTeachBtn');
  const groundingLabel = $('dxGroundingLabel');
  const selectionTopicsEl = $('dxSelectionTopics');
  const docTopicsEl = $('dxDocTopics');
  const previewTextEl = $('dxSelectionPreviewText');
  const previewCardEl = $('dxSelectionPreviewCard');
  const quickTeachBtn = $('dxQuickTeachBtn');

  // --- Banner & Notifications ---
  function showBanner(msg, type = 'info') {
    if (!banner) return;
    banner.textContent = msg;
    banner.className = `dx-banner ${type}`;
    banner.hidden = false;
  }
  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  // --- File Upload & Handlers ---
  function handleFile(file) {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    const isImg = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) || file.type.startsWith('image/');

    if (!isPdf && !isImg) {
      showBanner(`"${file.name}" is not supported on this page. Please upload a PDF or image (PNG/JPG/WebP).`, 'warn');
      return;
    }

    // Reset previous session and establish new one
    resetSession();
    state = createState();
    state.file = file;
    state.isImage = isImg;

    if (docBadge) docBadge.textContent = file.name;
    if (dropzone) dropzone.hidden = true;
    if (viewerBox) viewerBox.hidden = false;
    hideBanner();

    if (isImg) {
      loadSourceImage(file);
    } else {
      loadSourcePdf(file);
    }
  }

  // =========================================================================
  // IMAGE PIPELINE
  // =========================================================================
  function loadSourceImage(file) {
    const sId = state.sessionId;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (state.sessionId !== sId) return;
      state.sourceWidth = img.width;
      state.sourceHeight = img.height;
      state.totalPages = 1;
      state.currentPage = 1;
      state.imageElement = img;

      if (totalPagesEl) totalPagesEl.textContent = '1';
      if (pageInput) { pageInput.value = '1'; pageInput.disabled = true; }
      if (prevPageBtn) prevPageBtn.disabled = true;
      if (nextPageBtn) nextPageBtn.disabled = true;

      renderImagePage();
      updateGroundingLabel();
      scheduleTopicSuggestions();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (state.sessionId !== sId) return;
      showBanner('Failed to load image file.', 'error');
    };
    img.src = url;
  }

  function renderImagePage() {
    if (!state.imageElement) return;
    const containerWidth = canvasStage.clientWidth - 32;
    const baseScale = containerWidth > 0 ? Math.min(1.0, containerWidth / state.sourceWidth) : 1.0;
    const finalScale = baseScale * state.scale;

    docCanvas.width = Math.round(state.sourceWidth * finalScale);
    docCanvas.height = Math.round(state.sourceHeight * finalScale);

    const ctx = docCanvas.getContext('2d');
    ctx.drawImage(state.imageElement, 0, 0, docCanvas.width, docCanvas.height);

    updateZoomDisplay();
    updateSelectionDOM();
    updateSelectionStatus();
  }

  // =========================================================================
  // PDF PIPELINE
  // =========================================================================
  async function loadSourcePdf(file) {
    const sId = state.sessionId;
    showBanner('Loading PDF document...', 'info');

    try {
      const pdfjs = await ensurePdfJs();
      const arrayBuffer = await file.arrayBuffer();
      if (state.sessionId !== sId) return;

      const loadingTask = pdfjs.getDocument({
        data: arrayBuffer,
        disableFontFace: true,
        useSystemFonts: true
      });
      const pdfDoc = await loadingTask.promise;
      if (state.sessionId !== sId) return;

      state.pdfDoc = pdfDoc;
      state.totalPages = pdfDoc.numPages;
      state.currentPage = 1;

      if (totalPagesEl) totalPagesEl.textContent = String(state.totalPages);
      if (pageInput) { pageInput.value = '1'; pageInput.max = String(state.totalPages); pageInput.disabled = false; }
      if (prevPageBtn) prevPageBtn.disabled = true;
      if (nextPageBtn) nextPageBtn.disabled = state.totalPages <= 1;

      hideBanner();
      await renderPdfPage(1);

      // Extract outline or scan headings in background
      loadPdfOutline();
    } catch (err) {
      if (state.sessionId !== sId) return;
      if (err.name === 'PasswordException' || String(err.message).toLowerCase().includes('password')) {
        showBanner('This PDF is password-protected. Please remove the password and try again.', 'error');
      } else {
        showBanner('Could not read this PDF. The file may be damaged or invalid.', 'error');
      }
    }
  }

  async function renderPdfPage(pageNum) {
    if (!state.pdfDoc) return;
    const sId = state.sessionId;

    // Cancel in-flight render task if any
    if (state.currentRenderTask) {
      try { state.currentRenderTask.cancel(); } catch {}
      state.currentRenderTask = null;
    }

    try {
      const page = await state.pdfDoc.getPage(pageNum);
      if (state.sessionId !== sId) return;

      // Calculate scale
      const defaultViewport = page.getViewport({ scale: 1.0 });
      state.sourceWidth = defaultViewport.width;
      state.sourceHeight = defaultViewport.height;

      const stageWidth = canvasStage.clientWidth - 32;
      const fitScale = stageWidth > 0 ? (stageWidth / defaultViewport.width) : 1.0;
      const currentScale = (state.fitWidth ? fitScale : 1.0) * state.scale;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: currentScale * dpr });

      docCanvas.width = viewport.width;
      docCanvas.height = viewport.height;
      docCanvas.style.width = Math.round(viewport.width / dpr) + 'px';
      docCanvas.style.height = Math.round(viewport.height / dpr) + 'px';

      const ctx = docCanvas.getContext('2d');
      const renderContext = { canvasContext: ctx, viewport };
      state.currentRenderTask = page.render(renderContext);

      await state.currentRenderTask.promise;
      if (state.sessionId !== sId) return;
      state.currentRenderTask = null;

      // Extract text content of this page for bbox selection mapping
      const textContent = await page.getTextContent();
      if (state.sessionId !== sId) return;
      processPageTextItems(textContent, defaultViewport);

      updateZoomDisplay();
      updateSelectionDOM();
      updateSelectionStatus();
      updateGroundingLabel();
      scheduleTopicSuggestions();
    } catch (e) {
      if (e.name === 'RenderingCancelledException') return;
      if (state.sessionId !== sId) return;
      showBanner('Failed to render page: ' + e.message, 'error');
    }
  }

  function processPageTextItems(textContent, viewport) {
    const items = [];
    let full = '';
    const h = viewport.height;

    for (const item of textContent.items || []) {
      if (!item.str) continue;
      full += item.str + ' ';
      const tx = item.transform; // [scaleX, skewY, skewX, scaleY, tx, ty]
      const x = tx[4];
      const y = tx[5];
      const itemWidth = item.width || 10;
      const itemHeight = item.height || Math.abs(tx[3]) || 12;

      // Normalize into 0..1 coordinates (PDF coords: (0,0) is bottom-left)
      const nx = x / viewport.width;
      const ny = (h - y - itemHeight) / viewport.height; // convert to top-left 0..1
      const nw = itemWidth / viewport.width;
      const nh = itemHeight / viewport.height;

      items.push({
        str: item.str,
        cx: nx + nw / 2,
        cy: ny + nh / 2,
        nx, ny, nw, nh
      });
    }

    state.pageText = full.trim();
    state.pageTextItems = items;
  }

  // --- Document Outline & Recommended Topics ---
  async function loadPdfOutline() {
    if (!state.pdfDoc) return;
    const sId = state.sessionId;

    try {
      const outline = await state.pdfDoc.getOutline();
      if (state.sessionId !== sId) return;

      if (Array.isArray(outline) && outline.length > 0) {
        const topics = [];
        for (let i = 0; i < Math.min(outline.length, 30); i++) {
          const item = outline[i];
          if (!item.title) continue;
          topics.push({
            title: item.title.slice(0, 60),
            dest: item.dest
          });
        }
        renderDocTopics(topics);
        return;
      }
    } catch {
      // Outline not present
    }

    // Fallback: Scan headings in idle background batches (up to 60 pages)
    scanHeadingsBackground(sId);
  }

  async function scanHeadingsBackground(sId) {
    if (!state.pdfDoc) return;
    const maxScan = Math.min(state.totalPages, 60);
    const headingCandidates = [];
    const seen = new Set();

    for (let p = 1; p <= maxScan; p++) {
      if (state.sessionId !== sId) return;
      try {
        const page = await state.pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        for (const item of tc.items || []) {
          const s = (item.str || '').trim();
          const fontSize = Math.abs(item.transform?.[0] || item.height || 12);
          if (s.length > 4 && s.length < 75 && fontSize >= 14 && !s.endsWith('.')) {
            const lower = s.toLowerCase();
            if (!seen.has(lower)) {
              seen.add(lower);
              headingCandidates.push({ title: s, page: p });
            }
          }
        }
      } catch {}
      if (headingCandidates.length >= 16) break;
      await new Promise(r => setTimeout(r, 20)); // Yield to UI
    }

    if (state.sessionId === sId && headingCandidates.length > 0) {
      renderDocTopics(headingCandidates);
    }
  }

  function renderDocTopics(topics) {
    if (!docTopicsEl) return;
    docTopicsEl.replaceChildren();
    if (!topics.length) {
      docTopicsEl.innerHTML = '<span class="dx-chip-placeholder">No sections detected</span>';
      return;
    }

    topics.slice(0, 14).forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dx-topic-chip';
      btn.textContent = t.title;
      btn.onclick = () => {
        if (questionInput) questionInput.value = t.title;
        handOffToCanvas(t);
      };
      docTopicsEl.appendChild(btn);
    });
  }

  // =========================================================================
  // SELECTION RECTANGLE (Pointer Events, Mouse + Touch, 8 Handles, Esc)
  // =========================================================================
  let isPointerDown = false;
  let dragMode = null; // 'create' | 'move' | 'resize'
  let resizeDir = null;
  let startX = 0, startY = 0;
  let startBox = null;
  let rAF = null;

  function initCropInteraction() {
    if (!cropOverlay) return;

    cropOverlay.addEventListener('pointerdown', onPointerDown);
    cropOverlay.addEventListener('pointermove', onPointerMove);
    cropOverlay.addEventListener('pointerup', onPointerUp);
    cropOverlay.addEventListener('pointercancel', onPointerUp);

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state?.selection && !docsView.hidden) {
        clearSelection();
      }
    });

    if (selectWholeBtn) {
      selectWholeBtn.addEventListener('click', () => {
        if (!state) return;
        state.selection = { x: 0, y: 0, width: 1, height: 1 };
        updateSelectionDOM();
        updateSelectionStatus();
        scheduleTopicSuggestions();
      });
    }

    if (clearCropBtn) {
      clearCropBtn.addEventListener('click', () => clearSelection());
    }

    if (includeCropCheckbox) {
      includeCropCheckbox.addEventListener('change', e => {
        if (state) state.autoCropPic = e.target.checked;
      });
    }
  }

  function clearSelection() {
    if (!state) return;
    state.selection = null;
    state.selectedText = '';
    state.selectedCropB64 = null;
    updateSelectionDOM();
    updateSelectionStatus();
    scheduleTopicSuggestions();
  }

  function getOverlayCoords(e) {
    const rect = cropOverlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    return { x, y, width: rect.width, height: rect.height };
  }

  function onPointerDown(e) {
    if (!state) return;
    isPointerDown = true;
    cropOverlay.setPointerCapture(e.pointerId);

    const coords = getOverlayCoords(e);
    startX = coords.x;
    startY = coords.y;

    const handle = e.target.closest('.dx-crop-handle');
    const isInsideBox = e.target.closest('#dxCropBoxEl');

    if (handle) {
      dragMode = 'resize';
      resizeDir = handle.dataset.dir;
      startBox = getPixelSelection(coords.width, coords.height);
    } else if (isInsideBox) {
      dragMode = 'move';
      startBox = getPixelSelection(coords.width, coords.height);
    } else {
      dragMode = 'create';
      state.selection = {
        x: coords.x / coords.width,
        y: coords.y / coords.height,
        width: 0,
        height: 0
      };
      startBox = { x: coords.x, y: coords.y, width: 0, height: 0 };
    }
  }

  function onPointerMove(e) {
    if (!isPointerDown || !state) return;
    if (rAF) cancelAnimationFrame(rAF);

    rAF = requestAnimationFrame(() => {
      const coords = getOverlayCoords(e);
      const W = coords.width;
      const H = coords.height;
      if (W === 0 || H === 0) return;

      const dx = coords.x - startX;
      const dy = coords.y - startY;

      if (dragMode === 'create') {
        const x = Math.min(startX, coords.x);
        const y = Math.min(startY, coords.y);
        const w = Math.abs(coords.x - startX);
        const h = Math.abs(coords.y - startY);
        state.selection = { x: x / W, y: y / H, width: w / W, height: h / H };
      } else if (dragMode === 'move' && startBox) {
        let x = startBox.x + dx;
        let y = startBox.y + dy;
        x = Math.max(0, Math.min(W - startBox.width, x));
        y = Math.max(0, Math.min(H - startBox.height, y));
        state.selection = { x: x / W, y: y / H, width: startBox.width / W, height: startBox.height / H };
      } else if (dragMode === 'resize' && startBox && resizeDir) {
        let x = startBox.x;
        let y = startBox.y;
        let w = startBox.width;
        let h = startBox.height;

        if (resizeDir.includes('e')) w = Math.max(12, Math.min(W - x, startBox.width + dx));
        if (resizeDir.includes('s')) h = Math.max(12, Math.min(H - y, startBox.height + dy));
        if (resizeDir.includes('w')) {
          const maxLeft = startBox.x + startBox.width - 12;
          const newX = Math.min(maxLeft, Math.max(0, startBox.x + dx));
          w = startBox.width + (startBox.x - newX);
          x = newX;
        }
        if (resizeDir.includes('n')) {
          const maxTop = startBox.y + startBox.height - 12;
          const newY = Math.min(maxTop, Math.max(0, startBox.y + dy));
          h = startBox.height + (startBox.y - newY);
          y = newY;
        }
        state.selection = { x: x / W, y: y / H, width: w / W, height: h / H };
      }

      updateSelectionDOM();
    });
  }

  function onPointerUp(e) {
    if (!isPointerDown) return;
    isPointerDown = false;
    try { cropOverlay.releasePointerCapture(e.pointerId); } catch {}

    if (state?.selection) {
      // Discard tiny accidental clicks
      if (state.selection.width < 0.02 || state.selection.height < 0.02) {
        state.selection = null;
      }
    }

    dragMode = null;
    resizeDir = null;
    startBox = null;
    updateSelectionDOM();
    updateSelectionStatus();
    scheduleTopicSuggestions();
  }

  function getPixelSelection(w, h) {
    if (!state?.selection) return null;
    return {
      x: state.selection.x * w,
      y: state.selection.y * h,
      width: state.selection.width * w,
      height: state.selection.height * h
    };
  }

  function updateSelectionDOM() {
    if (!cropBoxEl || !cropOverlay) return;
    if (!state || !state.selection || state.selection.width <= 0 || state.selection.height <= 0) {
      cropBoxEl.hidden = true;
      return;
    }

    const rect = cropOverlay.getBoundingClientRect();
    const px = getPixelSelection(rect.width, rect.height);
    if (!px) {
      cropBoxEl.hidden = true;
      return;
    }

    cropBoxEl.style.left = `${px.x}px`;
    cropBoxEl.style.top = `${px.y}px`;
    cropBoxEl.style.width = `${px.width}px`;
    cropBoxEl.style.height = `${px.height}px`;
    cropBoxEl.hidden = false;
  }

  // --- Extract Selection Text & Thumbnail ---
  function updateSelectionStatus() {
    if (!state) return;

    if (!state.selection) {
      // Full page mode
      const pageChars = state.pageText.length;
      if (statusText) {
        statusText.textContent = state.isImage
          ? 'Selected: whole image'
          : `Selected: page ${state.currentPage} (${pageChars} chars)`;
      }
      renderThumbnail(null);
      updateGroundingLabel();
      if (previewTextEl) {
        previewTextEl.textContent = (state.pageText || '').trim() || (state.isImage ? 'Whole image page active.' : 'No text on current page.');
      }
      return;
    }

    // Calculate text inside selection rectangle
    let selText = '';
    if (!state.isImage && state.pageTextItems.length) {
      const box = state.selection;
      const matched = state.pageTextItems.filter(it => (
        it.cx >= box.x && it.cx <= (box.x + box.width) &&
        it.cy >= box.y && it.cy <= (box.y + box.height)
      ));
      // Sort vertically then horizontally
      matched.sort((a, b) => a.cy !== b.cy ? a.cy - b.cy : a.cx - b.cx);
      selText = matched.map(m => m.str).join(' ').slice(0, 6000).trim();
    }
    state.selectedText = selText;

    // Render crop thumbnail
    renderThumbnail(state.selection);

    const chars = selText.length;
    const isLowText = chars < 40;

    if (statusText) {
      statusText.textContent = state.isImage
        ? `Selected crop on image`
        : `Selected: page ${state.currentPage}, ${chars} chars${isLowText ? ' (diagram/equation)' : ''}`;
    }

    // Auto-tick "Also send picture of selection" for low-text regions or images
    if (includeCropCheckbox) {
      if (state.isImage || isLowText) {
        includeCropCheckbox.checked = true;
        state.autoCropPic = true;
      }
    }

    updateGroundingLabel();
    if (previewTextEl) {
      previewTextEl.textContent = selText || (state.isImage ? 'Image crop selected.' : 'No text detected in selection rectangle.');
    }
  }

  function renderThumbnail(sel) {
    if (!cropThumb || !docCanvas || docCanvas.width === 0) return;
    const ctx = cropThumb.getContext('2d');
    ctx.clearRect(0, 0, 44, 44);

    const cw = docCanvas.width;
    const ch = docCanvas.height;

    let sx = 0, sy = 0, sw = cw, sh = ch;
    if (sel) {
      sx = Math.round(sel.x * cw);
      sy = Math.round(sel.y * ch);
      sw = Math.max(1, Math.round(sel.width * cw));
      sh = Math.max(1, Math.round(sel.height * ch));
    }

    ctx.drawImage(docCanvas, sx, sy, sw, sh, 0, 0, 44, 44);
  }

  function extractCropBase64(sel) {
    if (!docCanvas || docCanvas.width === 0) return null;
    const offscreen = document.createElement('canvas');
    const cw = docCanvas.width;
    const ch = docCanvas.height;

    let sx = 0, sy = 0, sw = cw, sh = ch;
    if (sel) {
      sx = Math.round(sel.x * cw);
      sy = Math.round(sel.y * ch);
      sw = Math.max(1, Math.round(sel.width * cw));
      sh = Math.max(1, Math.round(sel.height * ch));
    }

    let dw = sw, dh = sh;
    const maxDim = 1024;
    if (dw > maxDim || dh > maxDim) {
      if (dw >= dh) { dh = Math.round((dh * maxDim) / dw); dw = maxDim; }
      else { dw = Math.round((dw * maxDim) / dh); dh = maxDim; }
    }

    offscreen.width = dw;
    offscreen.height = dh;
    const octx = offscreen.getContext('2d');
    octx.drawImage(docCanvas, sx, sy, sw, sh, 0, 0, dw, dh);
    return offscreen.toDataURL('image/jpeg', 0.8);
  }

  function updateGroundingLabel() {
    if (!groundingLabel || !state) return;
    if (state.isImage) {
      if (state.selection) {
        groundingLabel.innerHTML = 'Teaching from: <strong>selection on image</strong>';
        groundingLabel.classList.add('has-selection');
      } else {
        groundingLabel.innerHTML = 'Teaching from: image';
        groundingLabel.classList.remove('has-selection');
      }
    } else {
      if (state.selection) {
        const count = state.selectedText?.length || 0;
        groundingLabel.innerHTML = `Teaching from: <strong>selection on page ${state.currentPage} (${count} chars)</strong>`;
        groundingLabel.classList.add('has-selection');
      } else {
        groundingLabel.innerHTML = `Teaching from: page ${state.currentPage}`;
        groundingLabel.classList.remove('has-selection');
      }
    }
  }

  // --- Topic Suggestions (Debounced ~700ms) ---
  function scheduleTopicSuggestions() {
    if (!state) return;
    if (state.topicsDebounceTimer) clearTimeout(state.topicsDebounceTimer);
    if (state.topicsAbortController) {
      state.topicsAbortController.abort();
      state.topicsAbortController = null;
    }

    if (selectionTopicsEl) {
      selectionTopicsEl.innerHTML = '<span class="dx-chip-placeholder">Curating topics from selection...</span>';
    }

    state.topicsDebounceTimer = setTimeout(() => {
      fetchTopicSuggestions();
    }, 150);
  }

  async function fetchTopicSuggestions() {
    if (!state) return;
    const isSelection = !!state.selection;
    const text = (isSelection ? state.selectedText : state.pageText || '').trim();
    const sId = state.sessionId;

    if (!text && !state.isImage) {
      if (selectionTopicsEl) {
        selectionTopicsEl.innerHTML = '<span class="dx-chip-placeholder">Select a region to see suggestions...</span>';
      }
      return;
    }

    // Fast local topic extraction when text is abundant (>= 25 chars)
    if (text && text.length >= 25) {
      const suggestions = [];
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 5 && l.length < 80);
      for (const line of lines) {
        if (/^\d+$/.test(line) || /^(page|copyright|all rights)/i.test(line)) continue;
        const clean = line.replace(/^[\d.)\-*•\s]+/, '').trim();
        if (clean.length > 5 && clean.length < 65 && !suggestions.some(s => s.title.toLowerCase() === clean.toLowerCase())) {
          suggestions.push({ title: clean, facts: text.slice(0, 600) });
          if (suggestions.length >= 4) break;
        }
      }
      if (suggestions.length < 4) {
        suggestions.push({ title: `Explain: ${text.slice(0, 35)}...`, facts: text.slice(0, 600) });
        suggestions.push({ title: 'Step-by-step example', facts: text.slice(0, 600) });
        suggestions.push({ title: 'Key formulas & takeaways', facts: text.slice(0, 600) });
      }
      renderSelectionTopics(suggestions);
      return;
    }

    // Low-text diagram or image crop: query /api/docs/topics
    if (state.isImage || state.selection) {
      if (selectionTopicsEl) {
        selectionTopicsEl.innerHTML = '<span class="dx-chip-placeholder">Curating topics with AI...</span>';
      }
      try {
        const cropB64 = extractCropBase64(state.selection);
        const abortCtrl = new AbortController();
        state.topicsAbortController = abortCtrl;
        const res = await fetch('/api/docs/topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text || '',
            attachment: cropB64 ? { data: cropB64, mimeType: 'image/jpeg' } : undefined
          }),
          signal: abortCtrl.signal
        });
        if (res.ok && state && state.sessionId === sId) {
          const data = await res.json();
          if (Array.isArray(data.topics) && data.topics.length) {
            renderSelectionTopics(data.topics);
            return;
          }
        }
      } catch (_) {}
    }

    if (selectionTopicsEl) {
      selectionTopicsEl.innerHTML = '<span class="dx-chip-placeholder">Select a region to see suggestions...</span>';
    }
  }

  function renderSelectionTopics(topics) {
    if (!selectionTopicsEl) return;
    selectionTopicsEl.replaceChildren();

    if (!topics.length) {
      selectionTopicsEl.innerHTML = '<span class="dx-chip-placeholder">No suggestions available</span>';
      return;
    }

    topics.slice(0, 6).forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dx-topic-chip';
      btn.textContent = t.title;
      btn.onclick = () => {
        if (questionInput) questionInput.value = t.title;
        handOffToCanvas(t);
      };
      selectionTopicsEl.appendChild(btn);
    });
  }

  // =========================================================================
  // HAND-OFF TO AI CANVAS (#lessonApp)
  // =========================================================================
  function truncateAtSentence(text, maxChars) {
    if (!text || text.length <= maxChars) return text || '';
    const slice = text.slice(0, maxChars);
    const lastBoundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
    return (lastBoundary > maxChars * 0.4 ? slice.slice(0, lastBoundary + 1) : slice).trim();
  }

  async function handOffToCanvas(topicItemOrTitle) {
    if (!state) {
      showBanner('Upload a document or image first.', 'warn');
      return;
    }

    const typedQuestion = (questionInput?.value || '').trim();
    let topicTitle = '';
    let topicFacts = '';
    let topicVisualContext = '';

    if (typeof topicItemOrTitle === 'object' && topicItemOrTitle !== null) {
      topicTitle = topicItemOrTitle.title || '';
      topicFacts = topicItemOrTitle.facts || topicItemOrTitle.summary || '';
      topicVisualContext = topicItemOrTitle.visualContext || '';
    } else if (typeof topicItemOrTitle === 'string' && topicItemOrTitle) {
      topicTitle = topicItemOrTitle;
    }

    const shortTitle = (topicTitle || typedQuestion || 'Document concept').slice(0, 80);
    const hasSelection = !!state.selection;
    let contextText = '';

    // 1. Text Selection
    if (hasSelection && state.selectedText && state.selectedText.trim().length > 15) {
      contextText = truncateAtSentence(state.selectedText.trim(), 3600);
    }
    // 2. Low-text / Image Crop
    else if (hasSelection && (state.isImage || !state.selectedText || state.selectedText.trim().length <= 15)) {
      if (topicFacts) {
        contextText = [topicFacts, topicVisualContext].filter(Boolean).join('\n\nVisual context: ').slice(0, 9000);
      } else {
        // Call /api/docs/topics once to obtain grounded facts
        if (teachBtn) teachBtn.disabled = true;
        showBanner('Curating facts from selection...', 'info');
        try {
          const cropB64 = extractCropBase64(state.selection);
          const res = await fetch('/api/docs/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: state.selectedText || typedQuestion || '',
              attachment: cropB64 ? { data: cropB64, mimeType: 'image/jpeg' } : undefined
            })
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.topics) && data.topics.length > 0) {
              const best = data.topics[0];
              topicFacts = best.facts || best.summary || '';
              contextText = [topicFacts, data.visualContext || ''].filter(Boolean).join('\n\nVisual context: ').slice(0, 9000);
            }
          }
        } catch (_) {}
        finally {
          if (teachBtn) teachBtn.disabled = false;
          hideBanner();
        }

        if (!contextText) {
          showBanner('Select an area with some text, or a clearer part of the picture.', 'warn');
          return;
        }
      }
    }
    // 3. No Selection: Use current page text
    else {
      contextText = truncateAtSentence((state.pageText || '').trim(), 3600);
      if (topicFacts || topicVisualContext) {
        contextText = [contextText, topicFacts, topicVisualContext ? `Visual context: ${topicVisualContext}` : ''].filter(Boolean).join('\n\n').slice(0, 9000);
      }
      if (!contextText && state.isImage) {
        contextText = 'Visual diagram on uploaded image page. The original image is attached for direct visual inspection.';
      }
    }

    if (!contextText) {
      showBanner('No usable content found on this page. Please select a region with text or details.', 'warn');
      return;
    }

    const docName = (state.file ? state.file.name : 'Document').replace(/\.[^/.]+$/, '');
    const pageNum = state.currentPage || 1;

    // Compose concept (HARD LIMIT 4800 characters)
    let composedConcept = `Teach: ${shortTitle}\nUse the attached original visual as the primary source. Explain the complete concept shown, including how its components relate. Keep numbers, terms and formulas exactly as shown; identify unreadable details instead of guessing.\n\nSource: ${docName}, page ${pageNum}\nExtracted context:\n${contextText}`;
    if (composedConcept.length > 11000) {
      composedConcept = composedConcept.slice(0, 11000);
    }

    // Set #concept to short title and register single-use context
    const conceptInput = $('concept');
    if (conceptInput) conceptInput.value = shortTitle.trim();

    // Preserve the actual visual source during the Docs -> Canvas handoff.
    // A selected region is preferred; otherwise send the complete visible image/page.
    let visualAttachment = null;
    if (state.isImage || hasSelection) {
      const visualData = extractCropBase64(hasSelection ? state.selection : null);
      if (visualData) {
        visualAttachment = {
          name: `${docName || 'document'}-page-${pageNum}${hasSelection ? '-selection' : ''}.jpg`,
          mimeType: 'image/jpeg',
          data: visualData,
          size: Math.round(visualData.length * 0.75)
        };
      }
    }

    // Remove any stale attachment from the Canvas tab, then attach this document's visual.
    if (window._attachedFile) {
      const rm = $('fileRemoveBtn');
      if (rm) rm.click(); else window._attachedFile = null;
    }
    if (visualAttachment) window._attachedFile = visualAttachment;

    // generateLesson uses this expanded concept only while the visible title still matches.
    window._docContext = {
      shown: shortTitle.trim(),
      concept: composedConcept,
      sourceName: docName,
      page: pageNum,
      visualContext: topicVisualContext
    };

    // Mark session as parked so docs state is preserved
    window._docsParked = true;

    // Clean up in-flight docs timers before switching
    if (state.activeFetchController) state.activeFetchController.abort();
    if (state.topicsDebounceTimer) clearTimeout(state.topicsDebounceTimer);

    // Switch to AI Canvas mode
    const canvasBtn = document.querySelector('[data-mode="canvas"]');
    if (canvasBtn) {
      canvasBtn.click();
    } else {
      showBanner('Could not open whiteboard tutor canvas.', 'error');
      window._docsParked = false;
      return;
    }

    // Automatically trigger lesson generation on AI Canvas
    requestAnimationFrame(() => {
      const genBtn = $('generateBtn');
      if (genBtn) genBtn.click();
    });
  }

  // --- Toolbar & Zoom Navigation ---
  function updateZoomDisplay() {
    if (!zoomValEl || !state) return;
    zoomValEl.textContent = `${Math.round(state.scale * 100)}%`;
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      if (!state) return;
      state.fitWidth = false;
      state.scale = Math.min(2.5, state.scale + 0.15);
      state.isImage ? renderImagePage() : renderPdfPage(state.currentPage);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      if (!state) return;
      state.fitWidth = false;
      state.scale = Math.max(0.4, state.scale - 0.15);
      state.isImage ? renderImagePage() : renderPdfPage(state.currentPage);
    });
  }

  if (fitWidthBtn) {
    fitWidthBtn.addEventListener('click', () => {
      if (!state) return;
      state.fitWidth = true;
      state.scale = 1.0;
      state.isImage ? renderImagePage() : renderPdfPage(state.currentPage);
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (!state || state.currentPage <= 1) return;
      state.currentPage--;
      if (pageInput) pageInput.value = String(state.currentPage);
      clearSelection();
      renderPdfPage(state.currentPage);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (!state || state.currentPage >= state.totalPages) return;
      state.currentPage++;
      if (pageInput) pageInput.value = String(state.currentPage);
      clearSelection();
      renderPdfPage(state.currentPage);
    });
  }

  if (pageInput) {
    pageInput.addEventListener('change', () => {
      if (!state || !state.pdfDoc) return;
      let p = parseInt(pageInput.value, 10);
      if (isNaN(p)) p = 1;
      p = Math.max(1, Math.min(state.totalPages, p));
      state.currentPage = p;
      pageInput.value = String(p);
      clearSelection();
      renderPdfPage(p);
    });
  }

  if (changeFileBtn) {
    changeFileBtn.addEventListener('click', () => {
      resetSession();
      if (fileInput) fileInput.click();
    });
  }

  // --- Quick Chips & Question Box ---
  document.querySelectorAll('[data-quick]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (questionInput) questionInput.value = chip.dataset.quick;
      handOffToCanvas(chip.dataset.quick);
    });
  });

  if (teachBtn) teachBtn.addEventListener('click', () => handOffToCanvas());
  if (questionInput) {
    questionInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handOffToCanvas();
      }
    });
  }

  if (quickTeachBtn) {
    quickTeachBtn.addEventListener('click', () => {
      const q = state?.selectedText
        ? 'Explain the key concepts and formulas from this selection'
        : `Explain the core concepts from page ${state?.currentPage || 1}`;
      if (questionInput) questionInput.value = q;
      handOffToCanvas(q);
    });
  }

  // =========================================================================
  // LIFECYCLE & CLEANUP
  // =========================================================================
  function resetSession() {
    currentSessionId++;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (state) {
      if (state.activeFetchController) state.activeFetchController.abort();
      if (state.topicsAbortController) state.topicsAbortController.abort();
      if (state.topicsDebounceTimer) clearTimeout(state.topicsDebounceTimer);
      if (state.currentRenderTask) {
        try { state.currentRenderTask.cancel(); } catch {}
      }
      if (state.pdfDoc) {
        try { state.pdfDoc.destroy(); } catch {}
      }
    }

    state = null;
    if (docCanvas) {
      const ctx = docCanvas.getContext('2d');
      ctx.clearRect(0, 0, docCanvas.width, docCanvas.height);
    }
    if (cropThumb) {
      const ctx = cropThumb.getContext('2d');
      ctx.clearRect(0, 0, 44, 44);
    }
    if (cropBoxEl) cropBoxEl.hidden = true;
    if (docBadge) docBadge.textContent = 'No document loaded';
    if (viewerBox) viewerBox.hidden = true;
    if (dropzone) dropzone.hidden = false;
    if (fileInput) fileInput.value = '';
    if (questionInput) questionInput.value = '';
    if (docTopicsEl) docTopicsEl.innerHTML = '<span class="dx-chip-placeholder">Document sections will appear here...</span>';
    if (selectionTopicsEl) selectionTopicsEl.innerHTML = '<span class="dx-chip-placeholder">Select a region to see AI suggestions...</span>';
    if (groundingLabel) {
      groundingLabel.textContent = 'Teaching from: current page';
      groundingLabel.classList.remove('has-selection');
    }
    if (previewTextEl) {
      previewTextEl.textContent = 'No active selection. The current page text or selected area will ground the lesson.';
    }
    hideBanner();
  }

  window.neuraDocs = {
    reset: resetSession
  };

  // Synchronous mode change listener for Parked Lifecycle
  document.addEventListener('neura:modechange', e => {
    const { from, to } = e.detail || {};

    // 1. Hand-off from docs to canvas: keep session parked
    if (from === 'docs' && to === 'canvas' && window._docsParked) {
      if (state?.activeFetchController) state.activeFetchController.abort();
      if (state?.topicsDebounceTimer) clearTimeout(state.topicsDebounceTimer);
      return;
    }

    // 2. Returning to docs from canvas via "Back to document": resume parked session
    if (to === 'docs' && window._docsParked && state?.file) {
      requestAnimationFrame(() => {
        if (state.isImage) renderImagePage();
        else if (state.pdfDoc) renderPdfPage(state.currentPage);
        updateSelectionDOM();
        updateSelectionStatus();
      });
      return;
    }

    // 3. Entering docs from home (fresh start)
    if (to === 'docs' && from === 'home' && !window._docsParked) {
      resetSession();
      return;
    }

    // 4. Any other transition (Home, Chat, Video) completely cleans up docs
    if (window._docsParked && to !== 'canvas' && to !== 'docs') {
      window._docsParked = false;
      resetSession();
    }
  });

  // Attach Drag & Drop to Dropzone
  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', e => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => {
      if (e.target.files?.[0]) handleFile(e.target.files[0]);
    });
  }

  // Initialize crop interaction once
  initCropInteraction();

})();
