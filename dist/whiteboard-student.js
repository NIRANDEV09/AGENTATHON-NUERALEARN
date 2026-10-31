// NeuraLearn Student Interactive Whiteboard Controller
// Provides interactive drawing tools for students on the shared canvas:
// Pen/Freehand, Shapes (Rect, Circle, Line, Arrow), Text/Equation, Eraser,
// Object Selection & Dragging, Undo/Redo, Clear confirmation,
// and "Check My Work" vision analysis.

(function (window) {
  'use strict';

  class StudentWhiteboardController {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.svg = engine.svg;
      this.activeTool = 'select'; // 'select' | 'pen' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'eraser'
      this.activeColor = '#2563eb';
      this.activeWidth = 3;
      this.isDrawing = false;
      this.startPt = null;
      this.currentStroke = [];
      this.previewElem = null;
      this.selectedId = null;
      this.dragOffset = null;
      this.undoStack = [];
      this.redoStack = [];
      this.onStudentAction = options.onStudentAction || null;

      this.initEvents();
    }

    setTool(tool) {
      this.activeTool = tool;
      if (this.activeTool !== 'select') {
        this.deselect();
      }
      this.updateCursor();
    }

    setColor(color) {
      this.activeColor = color;
    }

    setWidth(width) {
      this.activeWidth = Number(width) || 3;
    }

    updateCursor() {
      if (!this.svg) return;
      if (this.activeTool === 'select') {
        this.svg.style.cursor = 'default';
      } else if (this.activeTool === 'eraser') {
        this.svg.style.cursor = 'cell';
      } else if (this.activeTool === 'text') {
        this.svg.style.cursor = 'text';
      } else {
        this.svg.style.cursor = 'crosshair';
      }
    }

    // Convert DOM client mouse coordinates to SVG 960x700 viewBox coordinates
    getSvgCoords(e) {
      if (!this.svg) return { x: 0, y: 0 };
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const screenCTM = this.svg.getScreenCTM();
      if (screenCTM) {
        const svgPt = pt.matrixTransform(screenCTM.inverse());
        return {
          x: Math.round(Math.max(0, Math.min(960, svgPt.x))),
          y: Math.round(Math.max(0, Math.min(700, svgPt.y)))
        };
      }
      const rect = this.svg.getBoundingClientRect();
      return {
        x: Math.round(((e.clientX - rect.left) / rect.width) * 960),
        y: Math.round(((e.clientY - rect.top) / rect.height) * 700)
      };
    }

    initEvents() {
      if (!this.svg) return;

      this.svg.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
      window.addEventListener('pointermove', (e) => this.handlePointerMove(e));
      window.addEventListener('pointerup', (e) => this.handlePointerUp(e));

      // Keyboard shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo), Delete (Delete Selected)
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          e.preventDefault();
          this.undo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
          e.preventDefault();
          this.redo();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
          e.preventDefault();
          this.deleteSelected();
        }
      });
    }

    handlePointerDown(e) {
      if (e.button !== 0) return; // primary button only
      const pt = this.getSvgCoords(e);
      this.isDrawing = true;
      this.startPt = pt;

      if (this.activeTool === 'select') {
        const targetObjId = this.findTargetObjectId(e.target);
        if (targetObjId) {
          this.selectObject(targetObjId);
          const obj = this.engine.objects.get(targetObjId);
          const curX = obj.x !== undefined ? obj.x : (obj.x1 !== undefined ? obj.x1 : (obj.cx || 0));
          const curY = obj.y !== undefined ? obj.y : (obj.y1 !== undefined ? obj.y1 : (obj.cy || 0));
          this.dragOffset = { dx: pt.x - curX, dy: pt.y - curY };
        } else {
          this.deselect();
        }
        return;
      }

      if (this.activeTool === 'eraser') {
        const targetObjId = this.findTargetObjectId(e.target);
        if (targetObjId) {
          this.eraseObject(targetObjId);
        }
        return;
      }

      if (this.activeTool === 'text') {
        this.promptTextAnnotation(pt);
        this.isDrawing = false;
        return;
      }

      // Drawing Shapes / Pen
      if (this.activeTool === 'pen') {
        this.currentStroke = [pt];
        this.createPreviewElement('path');
      } else if (this.activeTool === 'rect') {
        this.createPreviewElement('rect');
      } else if (this.activeTool === 'circle') {
        this.createPreviewElement('circle');
      } else if (this.activeTool === 'line' || this.activeTool === 'arrow') {
        this.createPreviewElement('path');
      }
    }

    handlePointerMove(e) {
      if (!this.isDrawing) return;
      const pt = this.getSvgCoords(e);

      if (this.activeTool === 'select' && this.selectedId && this.dragOffset) {
        const newX = pt.x - this.dragOffset.dx;
        const newY = pt.y - this.dragOffset.dy;
        this.engine.opMove(this.selectedId, 0, 0, newX, newY, false);
        this.renderSelectionBox(this.selectedId);
        return;
      }

      if (this.activeTool === 'eraser') {
        const targetObjId = this.findTargetObjectId(e.target);
        if (targetObjId) {
          this.eraseObject(targetObjId);
        }
        return;
      }

      if (!this.previewElem) return;

      if (this.activeTool === 'pen') {
        this.currentStroke.push(pt);
        const d = `M ${this.currentStroke[0].x} ${this.currentStroke[0].y} ` +
          this.currentStroke.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
        this.previewElem.setAttribute('d', d);
      } else if (this.activeTool === 'rect') {
        const x = Math.min(this.startPt.x, pt.x);
        const y = Math.min(this.startPt.y, pt.y);
        const w = Math.abs(pt.x - this.startPt.x);
        const h = Math.abs(pt.y - this.startPt.y);
        this.previewElem.setAttribute('x', x);
        this.previewElem.setAttribute('y', y);
        this.previewElem.setAttribute('width', Math.max(5, w));
        this.previewElem.setAttribute('height', Math.max(5, h));
      } else if (this.activeTool === 'circle') {
        const r = Math.round(Math.hypot(pt.x - this.startPt.x, pt.y - this.startPt.y));
        this.previewElem.setAttribute('cx', this.startPt.x);
        this.previewElem.setAttribute('cy', this.startPt.y);
        this.previewElem.setAttribute('r', Math.max(5, r));
      } else if (this.activeTool === 'line' || this.activeTool === 'arrow') {
        this.previewElem.setAttribute('d', `M ${this.startPt.x} ${this.startPt.y} L ${pt.x} ${pt.y}`);
        if (this.activeTool === 'arrow') {
          this.previewElem.setAttribute('marker-end', this.engine.getArrowMarker(this.activeColor));
        }
      }
    }

    handlePointerUp(e) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const pt = this.getSvgCoords(e);

      if (this.activeTool === 'select' && this.selectedId) {
        this.dragOffset = null;
        return;
      }

      if (!this.previewElem) return;
      this.previewElem.remove();
      this.previewElem = null;

      // Minimum stroke length / size check
      const dist = Math.hypot(pt.x - this.startPt.x, pt.y - this.startPt.y);
      if (dist < 5 && this.activeTool !== 'pen') return;

      const objId = `student_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      let operation = null;

      if (this.activeTool === 'pen') {
        if (this.currentStroke.length < 2) return;
        operation = {
          operation: 'create',
          object: {
            id: objId,
            type: 'path',
            points: this.currentStroke,
            stroke: this.activeColor,
            strokeWidth: this.activeWidth,
            createdBy: 'student',
            duration: 0
          }
        };
      } else if (this.activeTool === 'rect') {
        const x = Math.min(this.startPt.x, pt.x);
        const y = Math.min(this.startPt.y, pt.y);
        const w = Math.abs(pt.x - this.startPt.x);
        const h = Math.abs(pt.y - this.startPt.y);
        operation = {
          operation: 'create',
          object: {
            id: objId,
            type: 'rect',
            x, y, width: w, height: h,
            stroke: this.activeColor,
            strokeWidth: this.activeWidth,
            fill: '#ffffff',
            createdBy: 'student',
            duration: 0
          }
        };
      } else if (this.activeTool === 'circle') {
        const r = Math.round(Math.hypot(pt.x - this.startPt.x, pt.y - this.startPt.y));
        operation = {
          operation: 'create',
          object: {
            id: objId,
            type: 'circle',
            cx: this.startPt.x, cy: this.startPt.y, r,
            stroke: this.activeColor,
            strokeWidth: this.activeWidth,
            fill: '#ffffff',
            createdBy: 'student',
            duration: 0
          }
        };
      } else if (this.activeTool === 'line' || this.activeTool === 'arrow') {
        operation = {
          operation: 'create',
          object: {
            id: objId,
            type: this.activeTool,
            x1: this.startPt.x, y1: this.startPt.y,
            x2: pt.x, y2: pt.y,
            stroke: this.activeColor,
            strokeWidth: this.activeWidth,
            arrowEnd: this.activeTool === 'arrow',
            createdBy: 'student',
            duration: 0
          }
        };
      }

      if (operation) {
        this.engine.execute(operation, false);
        this.pushUndo({ type: 'create', id: objId, object: operation.object });
        if (typeof this.onStudentAction === 'function') {
          this.onStudentAction('create', objId, operation.object);
        }
      }
    }

    createPreviewElement(tag) {
      if (this.previewElem) this.previewElem.remove();
      this.previewElem = document.createElementNS('http://www.w3.org/2000/svg', tag);
      this.previewElem.setAttribute('stroke', this.activeColor);
      this.previewElem.setAttribute('stroke-width', this.activeWidth);
      this.previewElem.setAttribute('fill', 'none');
      this.previewElem.setAttribute('opacity', '0.7');
      this.previewElem.setAttribute('stroke-linecap', 'round');
      this.engine.layerInteractive.appendChild(this.previewElem);
    }

    findTargetObjectId(domNode) {
      let curr = domNode;
      while (curr && curr !== this.svg) {
        const id = curr.getAttribute?.('data-id') || curr.getAttribute?.('id');
        if (id && this.engine.objects.has(id)) {
          return id;
        }
        curr = curr.parentNode;
      }
      return null;
    }

    selectObject(id) {
      this.selectedId = id;
      this.renderSelectionBox(id);
    }

    deselect() {
      this.selectedId = null;
      const existing = document.getElementById('studentSelectionBox');
      if (existing) existing.remove();
    }

    renderSelectionBox(id) {
      const existing = document.getElementById('studentSelectionBox');
      if (existing) existing.remove();

      const dom = this.engine.domElements.get(id);
      if (!dom || typeof dom.getBBox !== 'function') return;

      try {
        const bbox = dom.getBBox();
        const pad = 6;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', 'studentSelectionBox');

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', bbox.x - pad);
        rect.setAttribute('y', bbox.y - pad);
        rect.setAttribute('width', bbox.width + pad * 2);
        rect.setAttribute('height', bbox.height + pad * 2);
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#3b82f6');
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '4 4');

        g.appendChild(rect);
        this.engine.layerInteractive.appendChild(g);
      } catch (_) {}
    }

    eraseObject(id) {
      const obj = this.engine.objects.get(id);
      if (!obj) return;
      this.pushUndo({ type: 'delete', id, previous: { ...obj } });
      this.engine.opDelete(id);
      this.deselect();
    }

    deleteSelected() {
      if (this.selectedId) {
        this.eraseObject(this.selectedId);
      }
    }

    promptTextAnnotation(pt) {
      const text = prompt('Enter whiteboard note or equation (e.g. F = ma, v = u + at):');
      if (!text || !text.trim()) return;

      const objId = `student_txt_${Date.now()}`;
      const isLatex = /[=+\-*/^θμπ√]/.test(text);

      const op = {
        operation: 'create',
        object: {
          id: objId,
          type: isLatex ? 'formula' : 'text',
          x: pt.x,
          y: pt.y,
          text: text.trim(),
          latex: isLatex ? text.trim() : undefined,
          color: this.activeColor,
          createdBy: 'student',
          duration: 0
        }
      };

      this.engine.execute(op, false);
      this.pushUndo({ type: 'create', id: objId, object: op.object });
    }

    // Undo / Redo
    pushUndo(action) {
      this.undoStack.push(action);
      this.redoStack = []; // reset redo on new action
      if (this.undoStack.length > 50) this.undoStack.shift();
    }

    undo() {
      if (!this.undoStack.length) return;
      const action = this.undoStack.pop();
      if (action.type === 'create') {
        const prev = this.engine.objects.get(action.id);
        this.redoStack.push({ type: 'create', id: action.id, object: prev });
        this.engine.opDelete(action.id);
      } else if (action.type === 'delete') {
        this.redoStack.push({ type: 'delete', id: action.id });
        this.engine.execute({ operation: 'create', object: action.previous }, false);
      }
      this.deselect();
    }

    redo() {
      if (!this.redoStack.length) return;
      const action = this.redoStack.pop();
      if (action.type === 'create') {
        this.undoStack.push({ type: 'create', id: action.id, object: action.object });
        this.engine.execute({ operation: 'create', object: action.object }, false);
      } else if (action.type === 'delete') {
        const prev = this.engine.objects.get(action.id);
        this.undoStack.push({ type: 'delete', id: action.id, previous: prev });
        this.engine.opDelete(action.id);
      }
      this.deselect();
    }

    clearWithConfirmation(target = 'all') {
      const msg = target === 'student'
        ? 'Clear all student drawings from the board?'
        : 'Clear the entire whiteboard?';
      if (confirm(msg)) {
        this.engine.opClear(target);
        this.deselect();
        this.undoStack = [];
        this.redoStack = [];
      }
    }
  }

  window.StudentWhiteboardController = StudentWhiteboardController;
})(typeof window !== 'undefined' ? window : this);

