// NeuraLearn Whiteboard Tutor Initialization and Dashboard Integration
// Integrates CanvasOperationEngine, StudentWhiteboardController, Socratic Tutor Chat,
// KaTeX mathematical rendering, adaptive scaffolding levels, and session persistence.

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  const svgEl = $('whiteboardSvg');
  if (!svgEl) return;

  // 1. Initialize Canvas Operation Engine & Student Controller
  const opEngine = new CanvasOperationEngine(svgEl, { sketchMode: true });
  window.canvasOpEngine = opEngine;

  const studentCtrl = new StudentWhiteboardController(opEngine, {
    onStudentAction: (actionType, id, obj) => {
      saveSessionDebounced();
    }
  });
  window.studentWhiteboard = studentCtrl;

  // 2. Initialize Legacy Renderer and Playback Controller (preserving existing lesson compatibility)
  const renderer = new WhiteboardRenderer(svgEl);
  renderer.opEngine = opEngine; // bridge to operation engine

  const controller = new WhiteboardPlaybackController({
    renderer,
    chatContainer: $('wbChatStream'),
    statusEl: $('wbStatusBar'),
    progressEl: $('wbProgressText'),
    progressBar: $('wbProgressBar'),
    stepPill: $('stepPill'),
    titleEl: $('lessonTitle'),
    topicRoadmapEl: $('sidebarRoadmap'),
    playBtn: $('wbPlayBtn'),
    voiceBtn: $('wbVoiceBtn'),
    voiceSpeedSlider: $('voiceSpeedSlider'),
    voiceSpeedVal: $('voiceSpeedVal'),
    quizBox: $('wbQuizCard'),
    quizQuestion: $('wbQuizQuestion'),
    quizOptions: $('wbQuizOptions'),
    quizFeedback: $('wbQuizFeedback')
  });

  window.wbController = controller;

  // Session state
  window._currentSessionId = 'session_' + Date.now().toString(36);
  window._currentScaffoldingLevel = 0;
  window._tutorBusy = false;

  // 3. Format Math Text with KaTeX or fallback
  function formatMathText(text) {
    if (!text) return '';
    let str = String(text);

    // KaTeX display math $$...$$
    if (typeof window !== 'undefined' && window.katex) {
      str = str.replace(/\$\$([^$]+)\$\$/g, (match, expr) => {
        try {
          return `<div class="katex-display">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`;
        } catch (_) { return match; }
      });
      // KaTeX inline math $...$
      str = str.replace(/\$([^$\n]+)\$/g, (match, expr) => {
        try {
          return window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
        } catch (_) { return match; }
      });
    }

    // Markdown formatting: bold, italic, line breaks
    str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');

    return str;
  }

  // 4. Update Scaffolding Badge
  function updateScaffoldBadge(level = 0) {
    window._currentScaffoldingLevel = level;
    const badge = $('wbScaffoldBadge');
    if (!badge) return;

    badge.className = `wb-scaffold-pill level-${level}`;
    const labels = [
      'Level 0: Concept',
      'Level 1: Hint & Analogy',
      'Level 2: Step-by-Step',
      'Level 3: Guided Work',
      'Level 4: Full Solution'
    ];
    badge.textContent = labels[level] || `Level ${level}`;
  }

  // 5. Append message to chat stream
  function appendChatMessage(role, content, heading = '') {
    const stream = $('wbChatStream');
    if (!stream) return;

    const msg = document.createElement('div');
    msg.className = `wb-msg ${role === 'user' ? 'student-msg' : 'active'}`;
    if (role === 'user') {
      msg.style.opacity = '1';
      msg.style.borderLeft = '4px solid #64748b';
      msg.style.background = '#f8fafc';
    }

    const head = document.createElement('div');
    head.className = 'wb-msg-head';
    head.textContent = heading || (role === 'user' ? 'You' : 'AI Tutor');
    if (role === 'user') head.style.color = '#475569';

    const p = document.createElement('div');
    p.innerHTML = formatMathText(content);

    msg.append(head, p);
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
  }

  // 6. Conversational AI Tutor Interaction (/api/tutor/chat)
  async function askTutor(messageText, options = {}) {
    const text = String(messageText || '').trim();
    if (!text && !options.canvasSnapshot) return;
    if (window._tutorBusy) return;

    window._tutorBusy = true;
    const sendBtn = $('wbSendInterrupt');
    if (sendBtn) sendBtn.disabled = true;

    // Interrupt ongoing voice playback immediately
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    controller.stopSpeech();
    opEngine.cancelAnimations();

    // Display user message in chat stream
    if (text) {
      appendChatMessage('user', text);
    }

    if ($('wbStatusBar')) $('wbStatusBar').textContent = 'AI Tutor is thinking and drawing...';

    try {
      const canvasSummary = opEngine.getCanvasSummary();
      const payload = {
        sessionId: window._currentSessionId,
        message: text,
        subject: 'Physics',
        topic: $('lessonTitle')?.textContent || $('concept')?.value || 'Interactive Lesson',
        canvasState: canvasSummary,
        scaffoldingLevel: window._currentScaffoldingLevel || 0,
        isInterruption: controller.isPlaying || false,
        canvasSnapshot: options.canvasSnapshot || undefined
      };

      const res = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Tutor error (${res.status})`);
      }

      const data = await res.json();

      // Update scaffolding level
      if (data.scaffoldingLevel !== undefined) {
        updateScaffoldBadge(data.scaffoldingLevel);
      }

      // Display AI Tutor response
      appendChatMessage('assistant', data.tutorMessage || 'Let us continue with this step.', 'AI Tutor');

      // Execute structured operations sequentially
      if (Array.isArray(data.operations) && data.operations.length > 0) {
        if ($('wbStatusBar')) $('wbStatusBar').textContent = `Drawing ${data.operations.length} visual element(s)...`;
        await opEngine.executeBatch(data.operations, !opEngine.reducedMotion);
      }

      // Speak narration with voice synthesis if enabled
      if (data.spokenNarration && !controller.isMuted) {
        controller.speakNarration(data.spokenNarration);
      }

      if ($('wbStatusBar')) {
        $('wbStatusBar').textContent = data.guidingQuestion || 'Ready for your next question or drawing.';
      }

      saveSessionDebounced();
    } catch (e) {
      if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Tutor notice: ' + e.message;
      appendChatMessage('assistant', `I encountered an issue: ${e.message}. Please try asking again.`, 'System');
    } finally {
      window._tutorBusy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // 7. Wire Student Toolbar Controls
  const toolButtons = document.querySelectorAll('.wb-tool-btn');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      toolButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tool = btn.dataset.tool;
      studentCtrl.setTool(tool);
    });
  });

  const colorChips = document.querySelectorAll('.wb-color-chip');
  colorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      colorChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      studentCtrl.setColor(chip.dataset.color);
    });
  });

  $('wbStrokeWidthSelect')?.addEventListener('change', e => {
    studentCtrl.setWidth(e.target.value);
  });

  $('wbUndoBtn')?.addEventListener('click', () => studentCtrl.undo());
  $('wbRedoBtn')?.addEventListener('click', () => studentCtrl.redo());
  $('wbClearStudentBtn')?.addEventListener('click', () => studentCtrl.clearWithConfirmation('student'));
  $('wbClearAllBtn')?.addEventListener('click', () => studentCtrl.clearWithConfirmation('all'));

  // "Check My Work" Vision Analysis
  $('wbCheckDrawingBtn')?.addEventListener('click', async () => {
    if (window._tutorBusy) return;
    if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Analyzing your whiteboard drawings & equations...';
    try {
      const snapshot = await opEngine.toDataURL();
      if (!snapshot) throw new Error('Could not capture canvas snapshot.');

      appendChatMessage('user', 'Please review and evaluate my drawing/equations on the board.');
      await askTutor('Please review my whiteboard drawing. Check my equations, vector directions, and problem solving.', { canvasSnapshot: snapshot });
    } catch (e) {
      if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Check work notice: ' + e.message;
    }
  });

  // Socratic Guidance Chips
  document.querySelectorAll('.wb-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const askPrompt = chip.dataset.ask;
      if (askPrompt) {
        askTutor(askPrompt);
      }
    });
  });

  // Wire Playback Buttons
  $('wbPlayBtn')?.addEventListener('click', () => {
    if (controller.isPlaying) {
      controller.pause();
    } else if (controller.isPaused) {
      controller.resume();
    } else if (controller.steps.length) {
      controller.playStep(controller.currentIndex);
    }
  });

  $('wbVoiceBtn')?.addEventListener('click', () => controller.toggleVoice());
  $('wbSketchBtn')?.addEventListener('click', () => {
    const isSketch = controller.renderer.toggleSketchMode();
    opEngine.setSketchMode(isSketch);
    if (controller.steps.length) controller.replayCurrentStep();
  });
  $('nextStepBtn')?.addEventListener('click', () => controller.nextStep());
  $('prevStepBtn')?.addEventListener('click', () => controller.prevStep());
  $('replayStepBtn')?.addEventListener('click', () => controller.replayCurrentStep());
  $('resetLessonBtn')?.addEventListener('click', () => {
    controller.resetLesson();
    opEngine.opClear('all');
  });
  $('downloadNotesBtn')?.addEventListener('click', () => controller.exportNotes());
  $('downloadSvgBtn')?.addEventListener('click', () => controller.exportSvg());

  // Interruption and Socratic input
  const sendInterrupt = () => {
    const input = $('wbInterruptInput');
    const cmd = input?.value?.trim();
    if (!cmd) return;
    input.value = '';
    askTutor(cmd);
  };

  $('wbSendInterrupt')?.addEventListener('click', sendInterrupt);
  $('wbInterruptInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendInterrupt();
  });

  // Speech recognition for mic button
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $('wbMicBtn');
  if (SR && micBtn) {
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      micBtn.textContent = '⏺';
      if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Listening for your question...';
    };
    recognition.onresult = e => {
      const text = e.results[0][0].transcript;
      if ($('wbInterruptInput')) $('wbInterruptInput').value = text;
      sendInterrupt();
    };
    recognition.onerror = e => {
      if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Voice input: ' + (e.error || 'unavailable');
    };
    recognition.onend = () => {
      micBtn.textContent = '🎙';
    };

    micBtn.addEventListener('click', () => {
      try { recognition.start(); } catch (_) {}
    });
  } else if (micBtn) {
    micBtn.disabled = true;
    micBtn.title = 'Speech recognition not supported in this browser';
  }

  // Quick Sample Topic Pills
  document.querySelectorAll('.wb-topic-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const prompt = pill.dataset.prompt;
      if (prompt && $('concept')) {
        $('concept').value = prompt;
        generateLesson();
      }
    });
  });

  // --- Image and PDF File Attachment Handling ---
  window._attachedFile = null;
  const fileInput = $('wbFileInput');
  const previewBadge = $('filePreviewBadge');
  const previewImg = $('filePreviewImg');
  const previewIcon = $('filePreviewIcon');
  const previewName = $('filePreviewName');
  const previewSize = $('filePreviewSize');
  const removeBtn = $('fileRemoveBtn');
  const uploadContainer = $('fileUploadContainer');
  const conceptArea = $('concept');

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function handleFile(file) {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) {
      alert('Please upload an image (PNG, JPG, WebP) or PDF document.');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const base64 = e.target.result;
      window._attachedFile = {
        name: file.name,
        mimeType: file.type || (isPdf ? 'application/pdf' : 'image/png'),
        data: base64,
        size: file.size
      };

      if (previewName) previewName.textContent = file.name;
      if (previewSize) previewSize.textContent = `(${formatBytes(file.size)})`;

      if (isImage && previewImg) {
        previewImg.src = base64;
        previewImg.style.display = 'inline-block';
        if (previewIcon) previewIcon.style.display = 'none';
      } else if (previewIcon) {
        if (previewImg) previewImg.style.display = 'none';
        previewIcon.style.display = 'inline-block';
      }

      if (previewBadge) previewBadge.style.display = 'inline-flex';
      if ($('wbStatusBar')) $('wbStatusBar').textContent = `Attached ${file.name}. Ready to build live lesson.`;

      if (conceptArea && !conceptArea.value.trim()) {
        conceptArea.value = `Solve and explain the question in this ${isImage ? 'image' : 'document'} step-by-step: ${file.name.replace(/\.[^/.]+$/, '')}`;
      }
    };
    reader.readAsDataURL(file);
  }

  fileInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  removeBtn?.addEventListener('click', () => {
    window._attachedFile = null;
    if (fileInput) fileInput.value = '';
    if (previewBadge) previewBadge.style.display = 'none';
    if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Attachment removed.';
  });

  // Drag and drop handling
  [conceptArea, uploadContainer].forEach(target => {
    if (!target) return;
    target.addEventListener('dragover', e => {
      e.preventDefault();
      target.classList.add('wb-dragover');
    });
    target.addEventListener('dragleave', () => {
      target.classList.remove('wb-dragover');
    });
    target.addEventListener('drop', e => {
      e.preventDefault();
      target.classList.remove('wb-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
  });

  // Main Lesson Generation Function
  let activeGenerationController = null;
  async function generateLesson() {
    const enteredConcept = $('concept')?.value?.trim() || '';
    const docContext = window._docContext;
    const concept = docContext && enteredConcept && enteredConcept === String(docContext.shown || '').trim()
      ? String(docContext.concept || enteredConcept).slice(0, 11000)
      : (enteredConcept || (window._attachedFile ? `Solve and explain the question in the attached ${window._attachedFile.name}` : ''));
    if (!concept && !window._attachedFile) {
      if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Please enter a question or attach an image / PDF.';
      $('concept')?.focus();
      return;
    }

    controller.stopPlayback();
    activeGenerationController?.abort();
    const abortCtrl = new AbortController();
    activeGenerationController = abortCtrl;

    const buildBtn = $('generateBtn');
    if (buildBtn) buildBtn.disabled = true;
    if ($('wbStatusBar')) $('wbStatusBar').textContent = window._attachedFile 
      ? `Analyzing ${window._attachedFile.name} & generating visual lesson...`
      : 'Preparing your animated whiteboard lesson...';
    if ($('modelBadge')) $('modelBadge').textContent = 'Connecting...';

    const payload = {
      concept,
      level: $('level')?.value || 'university beginner',
      language: $('language')?.value || 'English',
      preferences: $('preferences')?.value || 'Teach intuitively with animated whiteboard drawings.'
    };

    if (window._attachedFile) {
      payload.attachment = window._attachedFile;
    }

    try {
      if (window._attachedFile) {
        if ($('wbStatusBar')) $('wbStatusBar').textContent = `Analyzing ${window._attachedFile.name} & solving full question...`;
        if ($('modelBadge')) $('modelBadge').textContent = 'Solving Problem...';
        const fullRes = await fetch('/api/lesson', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortCtrl.signal
        });
        if (!fullRes.ok) {
          const err = await fullRes.json().catch(() => ({}));
          throw new Error(err.error || `Problem solving failed (${fullRes.status})`);
        }
        const lessonData = await fullRes.json();
        controller.loadLesson(lessonData, true);
        if ($('modelBadge')) $('modelBadge').textContent = `${lessonData.provider || 'NeuraLearn'} · Solved`;
        if ($('wbStatusBar')) $('wbStatusBar').textContent = `Full solution ready • ${lessonData.segments?.length || 0} steps`;
        return;
      }

      // Fast streaming endpoint
      let response;
      try {
        response = await fetch('/api/lesson/first/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortCtrl.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        response = null;
      }

      if (response && response.ok) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', fullText = '', firstScene = null;

        const processLine = line => {
          const l = line.trim();
          if (!l) return;
          try {
            const ev = JSON.parse(l);
            if (ev.type === 'delta' && ev.text) {
              fullText += ev.text;
              if (!firstScene) {
                try {
                  const parsed = JSON.parse(fullText);
                  if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) {
                    firstScene = parsed;
                    controller.loadLesson(parsed, true);
                    if ($('modelBadge')) $('modelBadge').textContent = 'Live Playing';
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            processLine(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
          }
        }
        if (buffer.trim()) processLine(buffer);

        if (firstScene && firstScene.segments && firstScene.segments.length > 1) {
          controller.loadLesson(firstScene, true);
          if ($('modelBadge')) $('modelBadge').textContent = `${firstScene.provider || 'Ready'} · Active`;
          if ($('wbStatusBar')) $('wbStatusBar').textContent = `Lesson ready • ${firstScene.segments.length} steps`;
          return;
        }

        if (firstScene && firstScene.segments) {
          const restRes = await fetch('/api/lesson/rest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              firstNarration: firstScene.segments[0]?.narration || '',
              firstActions: firstScene.segments[0]?.actions || firstScene.segments[0]?.visuals || []
            }),
            signal: abortCtrl.signal
          });

          if (restRes.ok) {
            const rest = await restRes.json();
            if (Array.isArray(rest.segments) && rest.segments.length) {
              const fullSegments = [firstScene.segments[0], ...rest.segments];
              const fullLesson = {
                ...firstScene,
                segments: fullSegments,
                checkpoint: rest.checkpoint || firstScene.checkpoint
              };
              controller.lesson = fullLesson;
              controller.steps = fullSegments;
              controller.renderTranscriptSidebar();
              controller.highlightTranscriptCard(controller.currentIndex);
              controller.updateControls();
              if ($('wbStatusBar')) $('wbStatusBar').textContent = `Full lesson loaded • ${fullSegments.length} steps`;
              if ($('modelBadge')) $('modelBadge').textContent = `${rest.provider || 'Gemini'} · Active`;
              return;
            }
          }
        }
      }

      // Fallback to /api/lesson
      const fallbackRes = await fetch('/api/lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortCtrl.signal
      });

      if (!fallbackRes.ok) {
        const err = await fallbackRes.json().catch(() => ({}));
        throw new Error(err.error || `Lesson request failed (${fallbackRes.status})`);
      }

      const lessonData = await fallbackRes.json();
      controller.loadLesson(lessonData, true);
      if ($('modelBadge')) $('modelBadge').textContent = `${lessonData.provider || 'NeuraLearn'} · Active`;
      if ($('wbStatusBar')) $('wbStatusBar').textContent = `Lesson ready • ${lessonData.segments?.length || 0} steps`;
    } catch (e) {
      if (e.name !== 'AbortError') {
        if ($('wbStatusBar')) $('wbStatusBar').textContent = 'Error: ' + e.message;
        if ($('modelBadge')) $('modelBadge').textContent = 'Error';
      }
    } finally {
      if (buildBtn) buildBtn.disabled = false;
      if (activeGenerationController === abortCtrl) activeGenerationController = null;
    }
  }

  $('generateBtn')?.addEventListener('click', generateLesson);

  // 8. Session Persistence & Restoration
  let saveTimer = null;
  function saveSessionDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const sessionPayload = {
          sessionId: window._currentSessionId,
          topic: $('lessonTitle')?.textContent || 'AI Tutor Session',
          scaffoldingLevel: window._currentScaffoldingLevel || 0,
          canvasObjects: opEngine.getCanvasSummary(),
          savedAt: Date.now()
        };
        localStorage.setItem('neuralelearn.tutor.session.v2', JSON.stringify(sessionPayload));
        fetch('/api/tutor/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionPayload)
        }).catch(() => {});
      } catch (_) {}
    }, 600);
  }

  // Restore session on load if available
  function restoreSession() {
    try {
      const raw = localStorage.getItem('neuralelearn.tutor.session.v2');
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.canvasObjects) && data.canvasObjects.length > 0) {
          window._currentSessionId = data.sessionId || window._currentSessionId;
          updateScaffoldBadge(data.scaffoldingLevel || 0);
          data.canvasObjects.forEach(obj => {
            opEngine.execute({ operation: 'create', object: obj }, false);
          });
          if ($('wbStatusBar')) $('wbStatusBar').textContent = `Restored session (${data.canvasObjects.length} objects).`;
        }
      }
    } catch (_) {}
  }

  restoreSession();

  // Bookmarks compatibility
  window.neuraLessonController = {
    hasLesson: () => !!(controller.lesson && controller.steps.length),
    replay: () => controller.playStep(0),
    bookmarkData: () => ({
      title: controller.lesson?.title || $('concept')?.value || 'Whiteboard Lesson',
      prompt: $('concept')?.value || controller.lesson?.title || '',
      notes: controller.exportNotesText ? controller.exportNotesText() : `# ${controller.lesson?.title || 'Lesson'}\n\n${controller.steps.map((s, i) => `## Step ${i+1}: ${s.heading}\n\n${s.narration}`).join('\n\n')}`
    })
  };
});
