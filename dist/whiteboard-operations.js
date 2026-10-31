// NeuraLearn Unified Whiteboard Operations Engine
// Manages shared AI & student canvas state, JSON operations contract,
// coordinate transformations, STEM primitives (graphs, physics, chemistry, KaTeX math),
// animated drawing execution queue, and canvas image snapshots for multimodal AI.

(function (window) {
  'use strict';

  // Coordinate Normalizer & Transformer (viewBox: 0 0 960 700)
  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 700;

  function normX(val) {
    if (typeof val === 'string' && val.trim().endsWith('%')) {
      return (parseFloat(val) / 100) * CANVAS_WIDTH;
    }
    const n = Number(val);
    return isNaN(n) ? 0 : Math.max(0, Math.min(CANVAS_WIDTH, n));
  }

  function normY(val) {
    if (typeof val === 'string' && val.trim().endsWith('%')) {
      return (parseFloat(val) / 100) * CANVAS_HEIGHT;
    }
    const n = Number(val);
    return isNaN(n) ? 0 : Math.max(0, Math.min(CANVAS_HEIGHT, n));
  }

  function generateId(prefix = 'obj') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // Structured Canvas Operation Engine
  class CanvasOperationEngine {
    constructor(svgElement, options = {}) {
      this.svg = typeof svgElement === 'string' ? document.getElementById(svgElement) : svgElement;
      this.objects = new Map(); // id -> Object Data
      this.domElements = new Map(); // id -> SVG DOM Element
      this.undoStack = [];
      this.redoStack = [];
      this.activeAnimations = [];
      this.sketchMode = options.sketchMode !== false; // Default true
      this.reducedMotion = options.reducedMotion || false;
      this.rc = null;
      this.onStateChange = options.onStateChange || null;

      // Detect system reduced motion preference
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mediaQuery.matches) this.reducedMotion = true;
      }

      this.init();
    }

    init() {
      if (!this.svg) return;
      this.svg.innerHTML = '';
      this.svg.setAttribute('viewBox', `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`);
      this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      this.svg.classList.add('wb-sketch-canvas');

      // Common SVG Definitions (markers, filters)
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
        <marker id="opArrowDefault" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#1e293b" />
        </marker>
        <marker id="opArrowBlue" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#2563eb" />
        </marker>
        <marker id="opArrowRed" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#dc2626" />
        </marker>
        <marker id="opArrowGreen" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#16a34a" />
        </marker>
        <marker id="opArrowAmber" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#d97706" />
        </marker>
        <marker id="opArrowPurple" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#9333ea" />
        </marker>
        <filter id="opHighlightGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      `;
      this.svg.appendChild(defs);

      // Hierarchical Layers
      this.layerGrid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.layerGrid.setAttribute('id', 'layer-grid');
      this.layerBase = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.layerBase.setAttribute('id', 'layer-base');
      this.layerShapes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.layerShapes.setAttribute('id', 'layer-shapes');
      this.layerVectors = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.layerVectors.setAttribute('id', 'layer-vectors');
      this.layerText = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.layerText.setAttribute('id', 'layer-text');
      this.layerInteractive = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.layerInteractive.setAttribute('id', 'layer-interactive');

      this.svg.append(this.layerGrid, this.layerBase, this.layerShapes, this.layerVectors, this.layerText, this.layerInteractive);

      // Initialize Rough.js
      if (typeof window !== 'undefined' && window.rough) {
        try {
          this.rc = window.rough.svg(this.svg);
        } catch (e) {
          this.rc = null;
        }
      }

      this.objects.clear();
      this.domElements.clear();
    }

    setSketchMode(enabled) {
      this.sketchMode = !!enabled;
      this.rerenderAll(false);
    }

    setReducedMotion(enabled) {
      this.reducedMotion = !!enabled;
    }

    notifyChange() {
      if (typeof this.onStateChange === 'function') {
        this.onStateChange(this.getCanvasSummary());
      }
    }

    getArrowMarker(color) {
      const hex = String(color || '').toLowerCase();
      if (hex.includes('blue') || hex.includes('2563') || hex.includes('3b82') || hex.includes('2b72')) return 'url(#opArrowBlue)';
      if (hex.includes('red') || hex.includes('dc26') || hex.includes('ef44') || hex.includes('c93d')) return 'url(#opArrowRed)';
      if (hex.includes('green') || hex.includes('16a3') || hex.includes('22c5') || hex.includes('2ea4')) return 'url(#opArrowGreen)';
      if (hex.includes('amber') || hex.includes('d977') || hex.includes('f59e') || hex.includes('e3a8') || hex.includes('orange')) return 'url(#opArrowAmber)';
      if (hex.includes('purple') || hex.includes('9333') || hex.includes('8b5c') || hex.includes('8252')) return 'url(#opArrowPurple)';
      return 'url(#opArrowDefault)';
    }

    cancelAnimations() {
      this.activeAnimations.forEach(id => clearTimeout(id));
      this.activeAnimations = [];
    }

    // -------------------------------------------------------------------------
    // Structured Operations Dispatcher (create, update, delete, clear, move, resize, annotate, highlight)
    // -------------------------------------------------------------------------

    execute(operation, animated = true) {
      if (!operation || typeof operation !== 'object') return false;
      const op = String(operation.operation || operation.op || 'create').toLowerCase();

      try {
        switch (op) {
          case 'create':
            return this.opCreate(operation.object || operation, animated && !this.reducedMotion);
          case 'update':
            return this.opUpdate(operation.id || (operation.object && operation.object.id), operation.changes || operation.object || operation, animated && !this.reducedMotion);
          case 'delete':
            return this.opDelete(operation.id, operation.ids);
          case 'move':
            return this.opMove(operation.id, operation.dx, operation.dy, operation.x, operation.y, animated && !this.reducedMotion);
          case 'resize':
            return this.opResize(operation.id, operation, animated && !this.reducedMotion);
          case 'annotate':
            return this.opAnnotate(operation.id, operation.text || operation.label, operation.position, operation.color);
          case 'highlight':
            return this.opHighlight(operation.id, operation.color, operation.duration);
          case 'clear':
            return this.opClear(operation.target || 'all');
          case 'group':
            return this.opGroup(operation.id, operation.memberIds);
          default:
            console.warn('Unknown canvas operation:', op);
            return false;
        }
      } catch (err) {
        console.error('Error executing canvas operation:', op, err);
        return false;
      }
    }

    // Execute an array of operations sequentially or with animated delay
    async executeBatch(operations, animated = true) {
      if (!Array.isArray(operations)) return;
      for (const op of operations) {
        this.execute(op, animated);
        if (animated && !this.reducedMotion) {
          const waitTime = Math.min(600, Math.max(120, Number(op.object?.duration || 250)));
          await new Promise(r => setTimeout(r, waitTime));
        }
      }
    }

    // CREATE Operation
    opCreate(objData, animated = true) {
      if (!objData) return false;
      const id = objData.id || generateId(objData.type || 'obj');
      const obj = { ...objData, id };
      this.objects.set(id, obj);
      this.renderObject(obj, animated);
      this.notifyChange();
      return id;
    }

    // UPDATE Operation (Modifies existing object by ID without recreating canvas)
    opUpdate(id, changes, animated = true) {
      if (!id || !this.objects.has(id)) return false;
      const existing = this.objects.get(id);
      const updated = { ...existing, ...changes, id }; // preserve ID
      this.objects.set(id, updated);
      this.renderObject(updated, animated);
      this.notifyChange();
      return true;
    }

    // DELETE Operation
    opDelete(id, ids) {
      const toDelete = ids ? (Array.isArray(ids) ? ids : [ids]) : (id ? [id] : []);
      for (const targetId of toDelete) {
        this.objects.delete(targetId);
        const dom = this.domElements.get(targetId);
        if (dom && dom.parentNode) {
          dom.parentNode.removeChild(dom);
        }
        this.domElements.delete(targetId);
      }
      this.notifyChange();
      return true;
    }

    // MOVE Operation
    opMove(id, dx = 0, dy = 0, newX = null, newY = null, animated = true) {
      if (!id || !this.objects.has(id)) return false;
      const obj = this.objects.get(id);

      if (newX !== null && newY !== null) {
        const curX = obj.x !== undefined ? obj.x : (obj.x1 !== undefined ? obj.x1 : (obj.cx !== undefined ? obj.cx : 0));
        const curY = obj.y !== undefined ? obj.y : (obj.y1 !== undefined ? obj.y1 : (obj.cy !== undefined ? obj.cy : 0));
        dx = newX - curX;
        dy = newY - curY;
      }

      if (obj.x !== undefined) obj.x = normX(obj.x + dx);
      if (obj.y !== undefined) obj.y = normY(obj.y + dy);
      if (obj.x1 !== undefined) {
        obj.x1 = normX(obj.x1 + dx);
        obj.x2 = normX(obj.x2 + dx);
      }
      if (obj.y1 !== undefined) {
        obj.y1 = normY(obj.y1 + dy);
        obj.y2 = normY(obj.y2 + dy);
      }
      if (obj.cx !== undefined) obj.cx = normX(obj.cx + dx);
      if (obj.cy !== undefined) obj.cy = normY(obj.cy + dy);

      this.objects.set(id, obj);
      this.renderObject(obj, animated);
      this.notifyChange();
      return true;
    }

    // RESIZE Operation
    opResize(id, params, animated = true) {
      if (!id || !this.objects.has(id)) return false;
      const obj = this.objects.get(id);

      if (params.width !== undefined) obj.width = normX(params.width);
      if (params.height !== undefined) obj.height = normY(params.height);
      if (params.r !== undefined) obj.r = Number(params.r);
      if (params.scale !== undefined && params.scale > 0) {
        const s = Number(params.scale);
        if (obj.width) obj.width = normX(obj.width * s);
        if (obj.height) obj.height = normY(obj.height * s);
        if (obj.r) obj.r = obj.r * s;
        if (obj.x2 !== undefined && obj.x1 !== undefined) {
          obj.x2 = obj.x1 + (obj.x2 - obj.x1) * s;
          obj.y2 = obj.y1 + (obj.y2 - obj.y1) * s;
        }
      }

      this.objects.set(id, obj);
      this.renderObject(obj, animated);
      this.notifyChange();
      return true;
    }

    // ANNOTATE Operation
    opAnnotate(id, text, position = 'top', color = '#2563eb') {
      if (!id || !this.objects.has(id)) return false;
      const obj = this.objects.get(id);
      obj.annotation = { text, position, color };
      this.objects.set(id, obj);
      this.renderObject(obj, false);
      this.notifyChange();
      return true;
    }

    // HIGHLIGHT Operation
    opHighlight(id, color = '#fef08a', duration = 2000) {
      const dom = this.domElements.get(id);
      if (!dom) return false;

      dom.classList.add('wb-highlighted');
      dom.style.filter = 'drop-shadow(0 0 10px ' + (color || '#fef08a') + ')';

      const timer = setTimeout(() => {
        dom.classList.remove('wb-highlighted');
        dom.style.filter = '';
      }, duration);
      this.activeAnimations.push(timer);
      return true;
    }

    // CLEAR Operation
    opClear(target = 'all') {
      this.cancelAnimations();
      if (target === 'student') {
        for (const [id, obj] of this.objects.entries()) {
          if (obj.createdBy === 'student') this.opDelete(id);
        }
      } else if (target === 'ai') {
        for (const [id, obj] of this.objects.entries()) {
          if (obj.createdBy !== 'student') this.opDelete(id);
        }
      } else {
        // all
        this.objects.clear();
        this.domElements.clear();
        this.layerGrid.innerHTML = '';
        this.layerBase.innerHTML = '';
        this.layerShapes.innerHTML = '';
        this.layerVectors.innerHTML = '';
        this.layerText.innerHTML = '';
        this.layerInteractive.innerHTML = '';
      }
      this.notifyChange();
      return true;
    }

    // GROUP Operation
    opGroup(groupId, memberIds = []) {
      for (const mId of memberIds) {
        if (this.objects.has(mId)) {
          const obj = this.objects.get(mId);
          obj.groupId = groupId;
          this.objects.set(mId, obj);
        }
      }
      return true;
    }

    // -------------------------------------------------------------------------
    // Rendering Dispatcher
    // -------------------------------------------------------------------------

    renderObject(obj, animated = true) {
      const type = String(obj.type || 'rect').toLowerCase();
      let elem = null;

      switch (type) {
        case 'rect':
        case 'square':
        case 'box':
          elem = this.drawRect(obj, animated);
          break;
        case 'circle':
        case 'ellipse':
          elem = this.drawCircle(obj, animated);
          break;
        case 'line':
        case 'arrow':
        case 'vector':
          elem = this.drawArrow(obj, animated);
          break;
        case 'path':
        case 'freehand':
        case 'curve':
          elem = this.drawPath(obj, animated);
          break;
        case 'text':
        case 'label':
          elem = this.drawText(obj, animated);
          break;
        case 'formula':
        case 'latex':
        case 'equation':
          elem = this.drawFormula(obj, animated);
          break;
        case 'graph_axes':
        case 'coordinate_graph':
        case 'axes':
          elem = this.drawGraphAxes(obj, animated);
          break;
        case 'function_plot':
        case 'plot':
          elem = this.drawFunctionPlot(obj, animated);
          break;
        case 'angle_arc':
        case 'angle':
          elem = this.drawAngleArc(obj, animated);
          break;
        case 'physics_incline':
        case 'incline_plane':
          elem = this.drawPhysicsIncline(obj, animated);
          break;
        case 'physics_pulley':
        case 'pulley':
          elem = this.drawPhysicsPulley(obj, animated);
          break;
        case 'physics_spring':
        case 'spring':
          elem = this.drawPhysicsSpring(obj, animated);
          break;
        case 'table':
        case 'calculation_table':
          elem = this.drawTable(obj, animated);
          break;
        case 'chemistry_molecule':
          elem = this.drawChemistryMolecule(obj, animated);
          break;
        default:
          elem = this.drawRect(obj, animated);
      }

      if (elem && obj.id) {
        elem.setAttribute('data-id', obj.id);
        elem.setAttribute('data-created-by', obj.createdBy || 'ai');
        elem.classList.toggle('wb-student-element', obj.createdBy === 'student');
        this.domElements.set(obj.id, elem);
      }
      return elem;
    }

    rerenderAll(animated = false) {
      const allObjs = Array.from(this.objects.values());
      this.layerGrid.innerHTML = '';
      this.layerBase.innerHTML = '';
      this.layerShapes.innerHTML = '';
      this.layerVectors.innerHTML = '';
      this.layerText.innerHTML = '';
      this.layerInteractive.innerHTML = '';
      this.domElements.clear();

      for (const obj of allObjs) {
        this.renderObject(obj, animated);
      }
    }

    // -------------------------------------------------------------------------
    // Primitive Drawers
    // -------------------------------------------------------------------------

    // 1. RECTANGLE / SQUARE
    drawRect(obj, animated) {
      const x = normX(obj.x);
      const y = normY(obj.y);
      const w = Math.max(10, normX(obj.width || obj.w || 80));
      const h = Math.max(10, normY(obj.height || obj.h || 60));
      const stroke = obj.stroke || '#2563eb';
      const strokeW = Number(obj.strokeWidth) || 2.5;
      const fill = (obj.fill && obj.fill !== 'none') ? obj.fill : '#ffffff';

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      if (this.sketchMode && this.rc && obj.rough !== false) {
        try {
          const roughRect = this.rc.rectangle(x, y, w, h, {
            roughness: obj.roughness || 1.4,
            bowing: obj.bowing || 1.2,
            stroke: stroke,
            strokeWidth: strokeW,
            fill: fill !== '#ffffff' ? fill : undefined,
            fillStyle: obj.fillStyle || 'hachure',
            fillWeight: 1.2,
            hachureGap: 6
          });
          g.appendChild(roughRect);
        } catch (_) {}
      } else {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('rx', obj.rx || 6);
        rect.setAttribute('stroke', stroke);
        rect.setAttribute('stroke-width', strokeW);
        rect.setAttribute('fill', fill);
        if (obj.strokeDasharray) rect.setAttribute('stroke-dasharray', obj.strokeDasharray);
        g.appendChild(rect);
      }

      // Optional text or mass label inside rect
      if (obj.label || obj.text) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + w / 2);
        text.setAttribute('y', y + h / 2);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', obj.color || stroke);
        text.setAttribute('font-size', (obj.fontSize || 15) + 'px');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', "'STIX Two Text', 'Inter', sans-serif");
        text.textContent = obj.label || obj.text;
        g.appendChild(text);
      }

      this.layerShapes.appendChild(g);

      if (animated) {
        this.animateDrawing(g, Number(obj.duration) || 700, Number(obj.delay) || 0);
      }
      return g;
    }

    // 2. CIRCLE / ELLIPSE
    drawCircle(obj, animated) {
      const cx = normX(obj.cx !== undefined ? obj.cx : obj.x);
      const cy = normY(obj.cy !== undefined ? obj.cy : obj.y);
      const r = Math.max(5, Number(obj.r || obj.radius || 25));
      const stroke = obj.stroke || '#2563eb';
      const strokeW = Number(obj.strokeWidth) || 2.5;
      const fill = (obj.fill && obj.fill !== 'none') ? obj.fill : '#ffffff';

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      if (this.sketchMode && this.rc && obj.rough !== false) {
        try {
          const roughCircle = this.rc.circle(cx, cy, 2 * r, {
            roughness: obj.roughness || 1.5,
            bowing: obj.bowing || 1.2,
            stroke: stroke,
            strokeWidth: strokeW,
            fill: fill !== '#ffffff' ? fill : undefined,
            fillStyle: obj.fillStyle || 'hachure',
            fillWeight: 1.2,
            hachureGap: 6
          });
          g.appendChild(roughCircle);
        } catch (_) {}
      } else {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', r);
        circle.setAttribute('stroke', stroke);
        circle.setAttribute('stroke-width', strokeW);
        circle.setAttribute('fill', fill);
        if (obj.strokeDasharray) circle.setAttribute('stroke-dasharray', obj.strokeDasharray);
        g.appendChild(circle);
      }

      if (obj.label || obj.text) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', cx);
        text.setAttribute('y', cy);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', obj.color || stroke);
        text.setAttribute('font-size', (obj.fontSize || 15) + 'px');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', "'STIX Two Text', 'Inter', sans-serif");
        text.textContent = obj.label || obj.text;
        g.appendChild(text);
      }

      this.layerShapes.appendChild(g);

      if (animated) {
        this.animateDrawing(g, Number(obj.duration) || 600, Number(obj.delay) || 0);
      }
      return g;
    }

    // 3. ARROW / VECTOR / LINE
    drawArrow(obj, animated) {
      const x1 = normX(obj.x1 !== undefined ? obj.x1 : obj.x);
      const y1 = normY(obj.y1 !== undefined ? obj.y1 : obj.y);
      const x2 = normX(obj.x2 !== undefined ? obj.x2 : x1 + 100);
      const y2 = normY(obj.y2 !== undefined ? obj.y2 : y1);
      const stroke = obj.stroke || '#2563eb';
      const strokeW = Number(obj.strokeWidth) || 2.5;
      const isArrow = obj.arrowEnd !== false && obj.type !== 'line';

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      if (this.sketchMode && this.rc && obj.rough !== false && !obj.strokeDasharray) {
        try {
          const shaft = this.rc.line(x1, y1, x2, y2, {
            roughness: 1.4,
            bowing: 1.1,
            stroke: stroke,
            strokeWidth: strokeW
          });
          g.appendChild(shaft);

          if (isArrow) {
            const theta = Math.atan2(y2 - y1, x2 - x1);
            const headLen = 14;
            const f1x = x2 - headLen * Math.cos(theta - 0.45);
            const f1y = y2 - headLen * Math.sin(theta - 0.45);
            const f2x = x2 - headLen * Math.cos(theta + 0.45);
            const f2y = y2 - headLen * Math.sin(theta + 0.45);

            const fin1 = this.rc.line(x2, y2, f1x, f1y, { stroke, strokeWidth: strokeW, roughness: 1.2 });
            const fin2 = this.rc.line(x2, y2, f2x, f2y, { stroke, strokeWidth: strokeW, roughness: 1.2 });
            g.append(fin1, fin2);
          }
        } catch (_) {}
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', strokeW);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill', 'none');
        if (obj.strokeDasharray) path.setAttribute('stroke-dasharray', obj.strokeDasharray);
        if (isArrow) path.setAttribute('marker-end', this.getArrowMarker(stroke));
        g.appendChild(path);
      }

      // Perpendicular Arrow Label
      if (obj.label || obj.text) {
        const theta = Math.atan2(y2 - y1, x2 - x1);
        const offset = 18;
        const perpX = -Math.sin(theta) * offset;
        const perpY = Math.cos(theta) * offset;
        const midX = (x1 + x2) / 2 + perpX;
        const midY = (y1 + y2) / 2 + perpY;

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midX);
        text.setAttribute('y', midY);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', obj.color || stroke);
        text.setAttribute('font-size', (obj.fontSize || 14) + 'px');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', "'STIX Two Text', 'Inter', sans-serif");
        text.textContent = obj.label || obj.text;
        g.appendChild(text);
      }

      this.layerVectors.appendChild(g);

      if (animated) {
        this.animateDrawing(g, Number(obj.duration) || 650, Number(obj.delay) || 0);
      }
      return g;
    }

    // 4. PATH / FREEHAND CURVE
    drawPath(obj, animated) {
      let d = obj.d || '';
      if (!d && Array.isArray(obj.points) && obj.points.length > 1) {
        d = `M ${obj.points[0].x} ${obj.points[0].y} ` + obj.points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
      }
      if (!d) return null;

      const stroke = obj.stroke || '#1e293b';
      const strokeW = Number(obj.strokeWidth) || 2.5;

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      if (this.sketchMode && this.rc && obj.rough !== false && obj.createdBy !== 'student') {
        try {
          const roughPath = this.rc.path(d, {
            roughness: obj.roughness || 1.3,
            bowing: obj.bowing || 1.1,
            stroke: stroke,
            strokeWidth: strokeW,
            fill: (obj.fill && obj.fill !== 'none') ? obj.fill : undefined
          });
          g.appendChild(roughPath);
        } catch (_) {}
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', strokeW);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('fill', obj.fill || 'none');
        if (obj.strokeDasharray) path.setAttribute('stroke-dasharray', obj.strokeDasharray);
        g.appendChild(path);
      }

      this.layerShapes.appendChild(g);

      if (animated) {
        this.animateDrawing(g, Number(obj.duration) || 800, Number(obj.delay) || 0);
      }
      return g;
    }

    // 5. TEXT / ANNOTATION
    drawText(obj, animated) {
      const x = normX(obj.x);
      const y = normY(obj.y);
      const str = String(obj.text || obj.label || '');

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', obj.anchor || 'start');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', obj.color || obj.stroke || '#1e293b');
      text.setAttribute('font-size', (obj.fontSize || 16) + 'px');
      text.setAttribute('font-weight', obj.fontWeight || '600');
      text.setAttribute('font-family', obj.fontFamily || (this.sketchMode ? "'Caveat', cursive, sans-serif" : "'Inter', sans-serif"));

      if (obj.angle) {
        text.setAttribute('transform', `rotate(${obj.angle} ${x} ${y})`);
      }

      text.textContent = str;
      g.appendChild(text);

      this.layerText.appendChild(g);

      if (animated) {
        g.style.opacity = '0';
        g.style.transition = `opacity ${obj.duration || 400}ms ease`;
        const timer = setTimeout(() => { g.style.opacity = '1'; }, obj.delay || 0);
        this.activeAnimations.push(timer);
      }
      return g;
    }

    // 6. MATHEMATICAL FORMULA (LaTeX / KaTeX)
    drawFormula(obj, animated) {
      const x = normX(obj.x);
      const y = normY(obj.y);
      const latex = String(obj.latex || obj.text || '');

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      // Card Background for equations
      if (obj.card !== false) {
        const padX = 14;
        const padY = 8;
        const estWidth = Math.max(80, latex.length * 10 + 28);
        const estHeight = 44;

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', x - 6);
        bg.setAttribute('y', y - estHeight / 2);
        bg.setAttribute('width', obj.width || estWidth);
        bg.setAttribute('height', obj.height || estHeight);
        bg.setAttribute('rx', 8);
        bg.setAttribute('fill', obj.fill || '#f8fafc');
        bg.setAttribute('stroke', obj.stroke || '#cbd5e1');
        bg.setAttribute('stroke-width', '1.5');
        g.appendChild(bg);
      }

      // ForeignObject for KaTeX if available
      if (typeof window !== 'undefined' && window.katex) {
        try {
          const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
          const foWidth = Math.max(120, latex.length * 12 + 40);
          fo.setAttribute('x', x);
          fo.setAttribute('y', y - 20);
          fo.setAttribute('width', foWidth);
          fo.setAttribute('height', 44);

          const div = document.createElement('div');
          div.style.color = obj.color || '#0f172a';
          div.style.fontSize = (obj.fontSize || 17) + 'px';
          div.style.lineHeight = '1';
          div.style.userSelect = 'none';

          window.katex.render(latex, div, { throwOnError: false, displayMode: false });
          fo.appendChild(div);
          g.appendChild(fo);
          this.layerText.appendChild(g);
          return g;
        } catch (_) {}
      }

      // High-Quality SVG STIX Math Fallback
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', obj.color || '#0f172a');
      text.setAttribute('font-size', (obj.fontSize || 18) + 'px');
      text.setAttribute('font-weight', '600');
      text.setAttribute('font-family', "'STIX Two Text', 'Cambria Math', serif");
      text.textContent = latex.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
        .replace(/\\theta/g, 'θ').replace(/\\mu/g, 'μ').replace(/\\pi/g, 'π')
        .replace(/\\cdot/g, '·').replace(/\\sqrt\{([^}]+)\}/g, '√($1)');
      g.appendChild(text);

      this.layerText.appendChild(g);

      if (animated) {
        g.style.opacity = '0';
        g.style.transition = `opacity 400ms ease`;
        const timer = setTimeout(() => { g.style.opacity = '1'; }, obj.delay || 0);
        this.activeAnimations.push(timer);
      }
      return g;
    }

    // 7. COORDINATE GRAPH AXES
    drawGraphAxes(obj, animated) {
      const ox = normX(obj.x || 120);
      const oy = normY(obj.y || 450);
      const w = normX(obj.width || 380);
      const h = normY(obj.height || 300);
      const stroke = obj.stroke || '#475569';
      const xLabel = obj.xLabel || 'x';
      const yLabel = obj.yLabel || 'y';

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      // Grid Lines
      if (obj.grid !== false) {
        const gridG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gridG.setAttribute('stroke', '#e2e8f0');
        gridG.setAttribute('stroke-width', '1');
        gridG.setAttribute('stroke-dasharray', '3 3');

        for (let i = 40; i < w; i += 40) {
          const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          l.setAttribute('x1', ox + i); l.setAttribute('y1', oy - h);
          l.setAttribute('x2', ox + i); l.setAttribute('y2', oy);
          gridG.appendChild(l);
        }
        for (let j = 40; j < h; j += 40) {
          const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          l.setAttribute('x1', ox); l.setAttribute('y1', oy - j);
          l.setAttribute('x2', ox + w); l.setAttribute('y2', oy - j);
          gridG.appendChild(l);
        }
        g.appendChild(gridG);
      }

      // X Axis
      const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      xAxis.setAttribute('d', `M ${ox - 20} ${oy} L ${ox + w + 20} ${oy}`);
      xAxis.setAttribute('stroke', stroke);
      xAxis.setAttribute('stroke-width', '2.5');
      xAxis.setAttribute('marker-end', this.getArrowMarker(stroke));
      g.appendChild(xAxis);

      // Y Axis
      const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      yAxis.setAttribute('d', `M ${ox} ${oy + 20} L ${ox} ${oy - h - 20}`);
      yAxis.setAttribute('stroke', stroke);
      yAxis.setAttribute('stroke-width', '2.5');
      yAxis.setAttribute('marker-end', this.getArrowMarker(stroke));
      g.appendChild(yAxis);

      // Origin label
      const origin = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      origin.setAttribute('x', ox - 12);
      origin.setAttribute('y', oy + 18);
      origin.setAttribute('font-size', '13px');
      origin.setAttribute('fill', '#64748b');
      origin.setAttribute('font-family', "'STIX Two Text', serif");
      origin.textContent = 'O';
      g.appendChild(origin);

      // Axis Labels
      const xLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xLbl.setAttribute('x', ox + w + 28);
      xLbl.setAttribute('y', oy + 5);
      xLbl.setAttribute('font-size', '15px');
      xLbl.setAttribute('font-weight', '700');
      xLbl.setAttribute('fill', stroke);
      xLbl.setAttribute('font-family', "'STIX Two Text', serif");
      xLbl.textContent = xLabel;
      g.appendChild(xLbl);

      const yLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      yLbl.setAttribute('x', ox - 5);
      yLbl.setAttribute('y', oy - h - 28);
      yLbl.setAttribute('font-size', '15px');
      yLbl.setAttribute('font-weight', '700');
      yLbl.setAttribute('fill', stroke);
      yLbl.setAttribute('font-family', "'STIX Two Text', serif");
      yLbl.textContent = yLabel;
      g.appendChild(yLbl);

      this.layerGrid.appendChild(g);

      if (animated) {
        this.animateDrawing(g, 900, obj.delay || 0);
      }
      return g;
    }

    // 8. FUNCTION PLOT
    drawFunctionPlot(obj, animated) {
      const ox = normX(obj.originX || obj.x || 120);
      const oy = normY(obj.originY || obj.y || 450);
      const scaleX = Number(obj.scaleX) || 40;
      const scaleY = Number(obj.scaleY) || 40;
      const stroke = obj.stroke || '#2563eb';
      const strokeW = Number(obj.strokeWidth) || 3;

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      let points = [];

      // Evaluate expression or custom points
      if (Array.isArray(obj.points) && obj.points.length > 0) {
        points = obj.points.map(p => ({ x: ox + p.x * scaleX, y: oy - p.y * scaleY }));
      } else {
        const expr = String(obj.functionExpr || 'x^2').toLowerCase();
        const minX = obj.minX !== undefined ? Number(obj.minX) : 0;
        const maxX = obj.maxX !== undefined ? Number(obj.maxX) : 6;
        const steps = 60;
        const stepSize = (maxX - minX) / steps;

        for (let i = 0; i <= steps; i++) {
          const xVal = minX + i * stepSize;
          let yVal = 0;
          try {
            if (expr.includes('x^2') || expr.includes('parabola')) {
              yVal = 0.3 * xVal * xVal;
            } else if (expr.includes('sin')) {
              yVal = Math.sin(xVal) * 2;
            } else if (expr.includes('cos')) {
              yVal = Math.cos(xVal) * 2;
            } else if (expr.includes('exp') || expr.includes('e^x')) {
              yVal = Math.exp(0.5 * xVal);
            } else {
              // linear default
              yVal = 1.2 * xVal;
            }
          } catch (_) { yVal = xVal; }

          points.push({ x: ox + xVal * scaleX, y: oy - yVal * scaleY });
        }
      }

      if (points.length > 1) {
        const d = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
        const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        curve.setAttribute('d', d);
        curve.setAttribute('stroke', stroke);
        curve.setAttribute('stroke-width', strokeW);
        curve.setAttribute('stroke-linecap', 'round');
        curve.setAttribute('fill', 'none');
        g.appendChild(curve);
      }

      // Key Points (e.g. roots, vertex)
      if (Array.isArray(obj.keyPoints)) {
        for (const kp of obj.keyPoints) {
          const kx = ox + (kp.x || 0) * scaleX;
          const ky = oy - (kp.y || 0) * scaleY;

          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', kx); dot.setAttribute('cy', ky); dot.setAttribute('r', 5);
          dot.setAttribute('fill', stroke); dot.setAttribute('stroke', '#ffffff'); dot.setAttribute('stroke-width', '2');
          g.appendChild(dot);

          if (kp.label) {
            const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            lbl.setAttribute('x', kx + 8); lbl.setAttribute('y', ky - 8);
            lbl.setAttribute('font-size', '13px'); lbl.setAttribute('font-weight', 'bold');
            lbl.setAttribute('fill', stroke);
            lbl.textContent = kp.label;
            g.appendChild(lbl);
          }
        }
      }

      this.layerShapes.appendChild(g);

      if (animated) {
        this.animateDrawing(g, 900, obj.delay || 0);
      }
      return g;
    }

    // 9. ANGLE ARC
    drawAngleArc(obj, animated) {
      const vx = normX(obj.x || obj.vertexX);
      const vy = normY(obj.y || obj.vertexY);
      const r = Number(obj.r || 35);
      const startAngle = (Number(obj.startAngle || 0) * Math.PI) / 180;
      const endAngle = (Number(obj.endAngle || obj.angle || 30) * Math.PI) / 180;
      const stroke = obj.stroke || '#d97706';

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      const x1 = vx + r * Math.cos(startAngle);
      const y1 = vy - r * Math.sin(startAngle);
      const x2 = vx + r * Math.cos(endAngle);
      const y2 = vy - r * Math.sin(endAngle);

      const d = `M ${x1} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y2}`;
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arc.setAttribute('d', d);
      arc.setAttribute('stroke', stroke);
      arc.setAttribute('stroke-width', '2');
      arc.setAttribute('fill', 'none');
      g.appendChild(arc);

      const midAngle = (startAngle + endAngle) / 2;
      const lblX = vx + (r + 16) * Math.cos(midAngle);
      const lblY = vy - (r + 16) * Math.sin(midAngle);

      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', lblX);
      lbl.setAttribute('y', lblY);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('dominant-baseline', 'middle');
      lbl.setAttribute('font-size', '14px');
      lbl.setAttribute('font-weight', '700');
      lbl.setAttribute('fill', stroke);
      lbl.setAttribute('font-family', "'STIX Two Text', serif");
      lbl.textContent = obj.label || 'θ';
      g.appendChild(lbl);

      this.layerShapes.appendChild(g);
      return g;
    }

    // 10. PHYSICS INCLINED PLANE (Inclined ramp + mass block)
    drawPhysicsIncline(obj, animated) {
      const bx = normX(obj.x || 140);
      const by = normY(obj.y || 480);
      const w = normX(obj.width || 420);
      const h = normY(obj.height || 220);
      const theta = Number(obj.angle || 30);
      const stroke = obj.stroke || '#334155';

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      // Triangular Incline
      const rampD = `M ${bx} ${by} L ${bx + w} ${by} L ${bx + w} ${by - h} Z`;
      const ramp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ramp.setAttribute('d', rampD);
      ramp.setAttribute('stroke', stroke);
      ramp.setAttribute('stroke-width', '3');
      ramp.setAttribute('fill', '#f8fafc');
      g.appendChild(ramp);

      // Ground Hatching Marks
      for (let x = bx; x <= bx + w; x += 22) {
        const hash = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hash.setAttribute('x1', x); hash.setAttribute('y1', by);
        hash.setAttribute('x2', x - 10); hash.setAttribute('y2', by + 12);
        hash.setAttribute('stroke', '#94a3b8'); hash.setAttribute('stroke-width', '1.5');
        g.appendChild(hash);
      }

      // Mass block on the slope
      if (obj.block !== false) {
        const rad = Math.atan2(h, w);
        const hyp = Math.sqrt(w * w + h * h);
        const blockDist = hyp * (Number(obj.blockPos) || 0.45);
        const slopeX = bx + blockDist * Math.cos(rad);
        const slopeY = by - blockDist * Math.sin(rad);

        const bw = 65, bh = 45;
        const deg = -(rad * 180) / Math.PI;

        const blockG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        blockG.setAttribute('transform', `translate(${slopeX}, ${slopeY}) rotate(${deg})`);

        const bRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bRect.setAttribute('x', -bw / 2); bRect.setAttribute('y', -bh);
        bRect.setAttribute('width', bw); bRect.setAttribute('height', bh);
        bRect.setAttribute('rx', 4); bRect.setAttribute('fill', '#e0f2fe');
        bRect.setAttribute('stroke', '#0284c7'); bRect.setAttribute('stroke-width', '2.5');

        const bLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        bLbl.setAttribute('x', 0); bLbl.setAttribute('y', -bh / 2);
        bLbl.setAttribute('text-anchor', 'middle'); bLbl.setAttribute('dominant-baseline', 'middle');
        bLbl.setAttribute('font-size', '14px'); bLbl.setAttribute('font-weight', 'bold');
        bLbl.setAttribute('fill', '#0369a1');
        bLbl.textContent = obj.blockLabel || 'm';

        blockG.append(bRect, bLbl);
        g.appendChild(blockG);
      }

      this.layerShapes.appendChild(g);

      if (animated) {
        this.animateDrawing(g, 850, obj.delay || 0);
      }
      return g;
    }

    // 11. PHYSICS PULLEY
    drawPhysicsPulley(obj, animated) {
      const cx = normX(obj.x || 300);
      const cy = normY(obj.y || 200);
      const r = Number(obj.r || 22);

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      // Pulley Wheel
      const wheel = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      wheel.setAttribute('cx', cx); wheel.setAttribute('cy', cy); wheel.setAttribute('r', r);
      wheel.setAttribute('stroke', '#334155'); wheel.setAttribute('stroke-width', '3'); wheel.setAttribute('fill', '#f1f5f9');

      // Center Pin
      const pin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pin.setAttribute('cx', cx); pin.setAttribute('cy', cy); pin.setAttribute('r', 4);
      pin.setAttribute('fill', '#0f172a');

      // Fixed Mount Bracket
      const mount = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      mount.setAttribute('d', `M ${cx} ${cy} L ${cx} ${cy - r - 25}`);
      mount.setAttribute('stroke', '#64748b'); mount.setAttribute('stroke-width', '3.5');

      g.append(mount, wheel, pin);
      this.layerShapes.appendChild(g);
      return g;
    }

    // 12. PHYSICS SPRING
    drawPhysicsSpring(obj, animated) {
      const x1 = normX(obj.x1 || 100);
      const y1 = normY(obj.y1 || 250);
      const x2 = normX(obj.x2 || 280);
      const y2 = normY(obj.y2 || 250);
      const coils = Number(obj.coils || 8);
      const amplitude = Number(obj.amplitude || 14);

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      const dx = (x2 - x1) / (coils * 2);
      let d = `M ${x1} ${y1} `;
      for (let i = 0; i < coils * 2; i++) {
        const cx = x1 + (i + 0.5) * dx;
        const cy = y1 + (i % 2 === 0 ? -amplitude : amplitude);
        const ex = x1 + (i + 1) * dx;
        const ey = y1;
        d += `Q ${cx} ${cy} ${ex} ${ey} `;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', obj.stroke || '#0284c7');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('fill', 'none');
      g.appendChild(path);

      this.layerShapes.appendChild(g);
      return g;
    }

    // 13. STEP-BY-STEP CALCULATION TABLE
    drawTable(obj, animated) {
      const x = normX(obj.x || 480);
      const y = normY(obj.y || 420);
      const w = normX(obj.width || 420);
      const rows = Array.isArray(obj.rows) ? obj.rows : [];
      const rowHeight = 36;
      const totalH = Math.max(80, (rows.length + 1) * rowHeight + 10);

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      // Card Container
      const card = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      card.setAttribute('x', x); card.setAttribute('y', y);
      card.setAttribute('width', w); card.setAttribute('height', totalH);
      card.setAttribute('rx', 10); card.setAttribute('fill', '#ffffff');
      card.setAttribute('stroke', obj.stroke || '#cbd5e1'); card.setAttribute('stroke-width', '1.5');
      card.setAttribute('filter', 'drop-shadow(0 4px 6px rgba(0,0,0,0.04))');
      g.appendChild(card);

      // Title/Header
      if (obj.title) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        title.setAttribute('x', x + 16); title.setAttribute('y', y + 24);
        title.setAttribute('font-size', '14px'); title.setAttribute('font-weight', 'bold');
        title.setAttribute('fill', '#1e293b');
        title.textContent = obj.title;
        g.appendChild(title);
      }

      // Rows
      rows.forEach((r, idx) => {
        const ry = y + 42 + idx * rowHeight;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x + 12); line.setAttribute('y1', ry);
        line.setAttribute('x2', x + w - 12); line.setAttribute('y2', ry);
        line.setAttribute('stroke', '#f1f5f9'); line.setAttribute('stroke-width', '1');
        g.appendChild(line);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + 16); text.setAttribute('y', ry + 20);
        text.setAttribute('font-size', '13.5px');
        text.setAttribute('fill', '#334155');
        text.setAttribute('font-family', "'STIX Two Text', 'Inter', monospace");
        text.textContent = typeof r === 'string' ? r : (r.step || r.text || '');
        g.appendChild(text);
      });

      this.layerShapes.appendChild(g);
      return g;
    }

    // 14. CHEMISTRY MOLECULE / REACTION
    drawChemistryMolecule(obj, animated) {
      const cx = normX(obj.x || 300);
      const cy = normY(obj.y || 300);
      const name = String(obj.name || obj.formula || 'H2O');

      let g = document.getElementById(obj.id);
      if (g) g.remove();

      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', obj.id);

      if (name.includes('benzene') || obj.structure === 'ring') {
        const r = 45;
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = (i * 60 * Math.PI) / 180;
          pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
        }
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pts.join(' '));
        poly.setAttribute('stroke', '#2563eb'); poly.setAttribute('stroke-width', '2.5'); poly.setAttribute('fill', 'none');
        const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        inner.setAttribute('cx', cx); inner.setAttribute('cy', cy); inner.setAttribute('r', 25);
        inner.setAttribute('stroke', '#2563eb'); inner.setAttribute('stroke-width', '2'); inner.setAttribute('fill', 'none'); inner.setAttribute('stroke-dasharray', '4 3');
        g.append(poly, inner);
      } else {
        // Water / simple molecule
        const central = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        central.setAttribute('x', cx); central.setAttribute('y', cy);
        central.setAttribute('font-size', '24px'); central.setAttribute('font-weight', 'bold');
        central.setAttribute('text-anchor', 'middle'); central.setAttribute('dominant-baseline', 'middle');
        central.setAttribute('fill', '#ef4444'); central.textContent = 'O';

        const h1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        h1.setAttribute('x', cx - 50); h1.setAttribute('y', cy + 45);
        h1.setAttribute('font-size', '18px'); h1.setAttribute('font-weight', 'bold');
        h1.setAttribute('text-anchor', 'middle'); h1.setAttribute('dominant-baseline', 'middle');
        h1.setAttribute('fill', '#3b82f6'); h1.textContent = 'H';

        const h2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        h2.setAttribute('x', cx + 50); h2.setAttribute('y', cy + 45);
        h2.setAttribute('font-size', '18px'); h2.setAttribute('font-weight', 'bold');
        h2.setAttribute('text-anchor', 'middle'); h2.setAttribute('dominant-baseline', 'middle');
        h2.setAttribute('fill', '#3b82f6'); h2.textContent = 'H';

        const b1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        b1.setAttribute('x1', cx - 12); b1.setAttribute('y1', cy + 10);
        b1.setAttribute('x2', cx - 40); b1.setAttribute('y2', cy + 35);
        b1.setAttribute('stroke', '#475569'); b1.setAttribute('stroke-width', '3');

        const b2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        b2.setAttribute('x1', cx + 12); b2.setAttribute('y1', cy + 10);
        b2.setAttribute('x2', cx + 40); b2.setAttribute('y2', cy + 35);
        b2.setAttribute('stroke', '#475569'); b2.setAttribute('stroke-width', '3');

        g.append(b1, b2, central, h1, h2);
      }

      this.layerShapes.appendChild(g);
      return g;
    }

    // -------------------------------------------------------------------------
    // Animation Helpers (Teacher Sketch Reveal)
    // -------------------------------------------------------------------------

    animateDrawing(gElement, duration = 700, delay = 0) {
      if (!gElement || this.reducedMotion) return;
      const paths = gElement.querySelectorAll('path, line, rect, circle, polygon');
      paths.forEach((p, idx) => {
        try {
          if (p.tagName.toLowerCase() === 'rect' || p.tagName.toLowerCase() === 'circle') {
            p.style.opacity = '0';
            p.style.transition = `opacity ${duration}ms ease`;
            const timer = setTimeout(() => { p.style.opacity = '1'; }, delay + idx * 50);
            this.activeAnimations.push(timer);
            return;
          }

          const len = (typeof p.getTotalLength === 'function') ? p.getTotalLength() : 300;
          if (len && !isNaN(len)) {
            p.style.strokeDasharray = len;
            p.style.strokeDashoffset = len;
            p.style.transition = 'none';

            const timer = setTimeout(() => {
              requestAnimationFrame(() => {
                p.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(.2,.75,.2,1)`;
                p.style.strokeDashoffset = '0';
              });
            }, delay + idx * 60);
            this.activeAnimations.push(timer);
          }
        } catch (_) {
          p.style.opacity = '1';
        }
      });
    }

    // -------------------------------------------------------------------------
    // Canvas State Serialization & Multimodal Vision Snapshot
    // -------------------------------------------------------------------------

    getCanvasSummary() {
      const list = [];
      for (const [id, obj] of this.objects.entries()) {
        list.push({
          id,
          type: obj.type,
          label: obj.label || obj.text || undefined,
          x: obj.x, y: obj.y,
          x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2,
          width: obj.width, height: obj.height, r: obj.r,
          stroke: obj.stroke, fill: obj.fill,
          createdBy: obj.createdBy || 'ai'
        });
      }
      return list;
    }

    // Convert SVG whiteboard to a high-resolution PNG data URL for Gemini Vision API
    async toDataURL() {
      if (!this.svg) return null;
      return new Promise((resolve) => {
        try {
          const serializer = new XMLSerializer();
          const svgStr = serializer.serializeToString(this.svg);
          const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          const URL = window.URL || window.webkitURL || window;
          const blobUrl = URL.createObjectURL(svgBlob);

          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
            const ctx = canvas.getContext('2d');
            // White background for teacher board
            ctx.fillStyle = '#fffdf8';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(blobUrl);
            const dataUrl = canvas.toDataURL('image/png', 0.95);
            resolve(dataUrl);
          };
          img.onerror = () => resolve(null);
          img.src = blobUrl;
        } catch (e) {
          resolve(null);
        }
      });
    }
  }

  window.CanvasOperationEngine = CanvasOperationEngine;
})(typeof window !== 'undefined' ? window : this);

