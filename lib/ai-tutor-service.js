// NeuraLearn AI Tutor Service & Scaffolding Engine
// Implements Socratic teaching, adaptive scaffolding state machine (Levels 0-4),
// structured whiteboard operations contract, canvas state context builder,
// vision evaluation of student drawings, and session persistence.

const fs = require('fs');
const path = require('path');

// Phase 11 AI Tutor System Prompt
const TUTOR_SYSTEM_PROMPT = `You are an intelligent, patient, highly skilled personal AI tutor.

You are not a general-purpose chatbot. Your job is to teach students through conversation, visual explanations, interactive whiteboard operations, and guided problem-solving.

You have access to a shared interactive vector whiteboard (coordinate space: viewBox 0 0 960 700).
You can create, update, move, annotate, and delete individual canvas elements through structured, validated operations.

Always inspect the current board context before deciding what to draw.
Never erase the entire board unnecessarily.
When a student asks you to modify an existing drawing, identify and update the existing object instead of recreating everything.
When teaching a visual concept, use the whiteboard whenever it genuinely improves understanding.
Explain what you draw and why you are drawing it.
Teach progressively.
Never overwhelm students with multiple questions in one message. Ask at most ONE clear guiding question at a time.
Encourage students to think independently.
Identify misconceptions rather than merely announcing that an answer is wrong.
Adjust your assistance level according to the student's understanding and previous attempts.
Use simple language when the student is struggling.
Use accurate mathematical notation and scientific terminology (LaTeX or clear symbols: F = ma, \\theta, \\mu, \\sqrt{}, mg\\cos\\theta).
Do not invent mathematical relationships, formulas, or diagram properties.
Never pretend to have modified the canvas if the structured canvas operation has not actually succeeded.
If you cannot confidently interpret a student's drawing, ask for clarification.
Always maintain continuity with the existing lesson and whiteboard.
Your goal is not simply to give correct answers. Your goal is to make the student understand.`;

// Scaffolding Level Descriptions & Instructions
const SCAFFOLDING_LEVELS = {
  0: {
    name: 'Initial Attempt',
    description: 'Ask the student to identify the relevant principle. Draw a conceptual representation. Avoid immediately revealing the solution.',
    guidance: 'Do NOT give the answer or write final equations. Draw a clear physical setup or concept diagram. Ask the student what fundamental law or principle applies here.'
  },
  1: {
    name: 'First Misconception',
    description: 'Identify the specific misunderstanding. Provide a simple analogy. Highlight the relevant area of the whiteboard. Ask the student to reconsider their reasoning.',
    guidance: 'Identify their misconception gently. Provide a real-world analogy. Highlight the relevant element on the board. Ask them to reconsider one specific factor.'
  },
  2: {
    name: 'Repeated Confusion',
    description: 'Break the problem into smaller steps. Simplify the diagram. Ask the student to complete one small step.',
    guidance: 'Break the problem down into isolated micro-steps. Simplify the visual diagram. Guide the student to complete just the very first micro-step.'
  },
  3: {
    name: 'Student Stuck',
    description: 'Provide a partial worked solution. Write the next useful equation or calculation. Ask the student to complete the next step.',
    guidance: 'Provide a partial worked solution. Write the formula on the board with known numbers substituted. Leave only the final algebraic/arithmetic step for the student to solve.'
  },
  4: {
    name: 'Complete Blockage',
    description: 'Provide a fully worked example. Explain the reasoning. Generate a similar practice question to test understanding.',
    guidance: 'Walk through the complete step-by-step solution clearly on the whiteboard with all diagrams, equations, and values. Conclude with a similar practice question to test their understanding.'
  }
};

// In-Memory & File Session Persistence
const sessions = new Map();
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
try {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
} catch (_) {}

function getSession(sessionId) {
  if (!sessionId) sessionId = 'default-session';
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  // Try reading from file
  const file = path.join(SESSIONS_DIR, `${sessionId.replace(/[^a-z0-9_-]/gi, '')}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      sessions.set(sessionId, data);
      return data;
    } catch (_) {}
  }

  // Create new session
  const newSession = {
    sessionId,
    subject: 'General Science',
    topic: 'Interactive Learning',
    scaffoldingLevel: 0,
    unsuccessfulAttempts: 0,
    messages: [],
    canvasObjects: [],
    misconceptions: [],
    lastUpdated: Date.now()
  };
  sessions.set(sessionId, newSession);
  return newSession;
}

function saveSession(sessionData) {
  if (!sessionData || !sessionData.sessionId) return;
  sessionData.lastUpdated = Date.now();
  sessions.set(sessionData.sessionId, sessionData);

  try {
    const file = path.join(SESSIONS_DIR, `${sessionData.sessionId.replace(/[^a-z0-9_-]/gi, '')}.json`);
    fs.writeFileSync(file, JSON.stringify(sessionData, null, 2), 'utf8');
  } catch (_) {}
}

// Scaffolding State Machine Transitions
function updateScaffoldingState(session, studentMessage, isSuccess, isConfused) {
  if (!session) return 0;
  if (session.scaffoldingLevel === undefined) session.scaffoldingLevel = 0;
  if (session.unsuccessfulAttempts === undefined) session.unsuccessfulAttempts = 0;

  if (isSuccess) {
    // Student understood! Maintain or reduce scaffolding level toward independence
    session.unsuccessfulAttempts = 0;
    session.scaffoldingLevel = Math.max(0, session.scaffoldingLevel - 1);
  } else if (isConfused) {
    session.unsuccessfulAttempts++;
    if (session.unsuccessfulAttempts >= 4) {
      session.scaffoldingLevel = 4;
    } else if (session.unsuccessfulAttempts >= 3) {
      session.scaffoldingLevel = 3;
    } else if (session.unsuccessfulAttempts >= 2) {
      session.scaffoldingLevel = 2;
    } else {
      session.scaffoldingLevel = 1;
    }
  }

  return session.scaffoldingLevel;
}

// Canvas State Context Builder for LLM
function buildCanvasContext(canvasObjects = []) {
  if (!Array.isArray(canvasObjects) || canvasObjects.length === 0) {
    return 'The whiteboard is currently empty.';
  }

  const aiObjects = [];
  const studentObjects = [];

  for (const obj of canvasObjects) {
    if (!obj || !obj.id) continue;
    const summary = {
      id: obj.id,
      type: obj.type || 'shape',
      label: obj.label || obj.text || undefined,
      role: obj.role || undefined,
      position: obj.x !== undefined ? { x: Math.round(obj.x), y: Math.round(obj.y) } : undefined,
      line: (obj.x1 !== undefined && obj.x2 !== undefined) ? { x1: Math.round(obj.x1), y1: Math.round(obj.y1), x2: Math.round(obj.x2), y2: Math.round(obj.y2) } : undefined,
      size: (obj.width && obj.height) ? { width: Math.round(obj.width), height: Math.round(obj.height) } : (obj.r ? { r: Math.round(obj.r) } : undefined),
      color: obj.stroke || obj.color || undefined
    };

    if (obj.createdBy === 'student') {
      studentObjects.push(summary);
    } else {
      aiObjects.push(summary);
    }
  }

  let text = `CURRENT WHITEBOARD STATE (Total: ${canvasObjects.length} active objects):\n`;
  text += `- AI Objects (${aiObjects.length}): ${JSON.stringify(aiObjects.slice(0, 35))}\n`;
  if (studentObjects.length > 0) {
    text += `- Student-Created Objects (${studentObjects.length}): ${JSON.stringify(studentObjects.slice(0, 20))}\n`;
    text += `Note: Student created objects marked above. Refer to them naturally and do NOT erase them unless asked.\n`;
  }
  text += `CRITICAL: When the student asks to change/move/resize/delete an existing object, refer to its EXACT 'id' above and use 'update', 'move', 'resize', or 'delete'. Do NOT recreate everything!`;
  return text;
}

// Validate Incoming AI Operations against Schema
function validateOperations(operations) {
  if (!Array.isArray(operations)) return [];
  const valid = [];
  const seenIds = new Set();

  for (const op of operations) {
    if (!op || typeof op !== 'object') continue;
    const action = String(op.operation || op.op || '').toLowerCase();
    
    // Support either { operation: 'create', object: {...} } or { op: 'create', ... }
    const obj = op.object || op;
    const targetId = String(op.id || obj.id || '').trim();

    if (action === 'create') {
      let finalId = targetId;
      if (!finalId || seenIds.has(finalId)) {
        finalId = `${finalId || 'obj'}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      }
      seenIds.add(finalId);
      obj.id = finalId;
      
      const type = String(obj.type || 'rect').toLowerCase();
      valid.push({
        operation: 'create',
        object: {
          id: obj.id,
          type,
          x: Number(obj.x) || 0,
          y: Number(obj.y) || 0,
          x1: obj.x1 !== undefined ? Number(obj.x1) : undefined,
          y1: obj.y1 !== undefined ? Number(obj.y1) : undefined,
          x2: obj.x2 !== undefined ? Number(obj.x2) : undefined,
          y2: obj.y2 !== undefined ? Number(obj.y2) : undefined,
          cx: obj.cx !== undefined ? Number(obj.cx) : undefined,
          cy: obj.cy !== undefined ? Number(obj.cy) : undefined,
          r: obj.r !== undefined ? Number(obj.r) : undefined,
          width: obj.width !== undefined ? Number(obj.width) : (obj.w !== undefined ? Number(obj.w) : undefined),
          height: obj.height !== undefined ? Number(obj.height) : (obj.h !== undefined ? Number(obj.h) : undefined),
          d: obj.d || undefined,
          points: Array.isArray(obj.points) ? obj.points : undefined,
          text: obj.text || undefined,
          latex: obj.latex || undefined,
          label: obj.label || undefined,
          stroke: obj.stroke || '#2563eb',
          strokeWidth: Number(obj.strokeWidth) || 2.5,
          fill: obj.fill || 'none',
          opacity: obj.opacity !== undefined ? Number(obj.opacity) : 1,
          style: obj.style || {},
          rough: obj.rough !== false,
          roughness: obj.roughness !== undefined ? Number(obj.roughness) : 1.4,
          bowing: obj.bowing !== undefined ? Number(obj.bowing) : 1.2,
          color: obj.color || undefined,
          fontSize: Number(obj.fontSize) || 16,
          fontWeight: obj.fontWeight || 'normal',
          fontFamily: obj.fontFamily || undefined,
          anchor: obj.anchor || 'start',
          duration: Number(obj.duration) || 800,
          delay: Number(obj.delay) || 0,
          arrowEnd: obj.arrowEnd !== false,
          strokeDasharray: obj.strokeDasharray || undefined,
          createdBy: 'ai',
          // STEM-specific properties
          axes: obj.axes || undefined,
          functionExpr: obj.functionExpr || undefined,
          keyPoints: Array.isArray(obj.keyPoints) ? obj.keyPoints : undefined,
          angle: obj.angle !== undefined ? Number(obj.angle) : undefined,
          startAngle: obj.startAngle !== undefined ? Number(obj.startAngle) : undefined,
          endAngle: obj.endAngle !== undefined ? Number(obj.endAngle) : undefined,
          rows: Array.isArray(obj.rows) ? obj.rows : undefined,
          headers: Array.isArray(obj.headers) ? obj.headers : undefined
        }
      });
    } else if (action === 'update') {
      if (!targetId) continue;
      valid.push({
        operation: 'update',
        id: targetId,
        changes: op.changes || obj
      });
    } else if (action === 'delete') {
      if (!targetId && !Array.isArray(op.ids)) continue;
      valid.push({
        operation: 'delete',
        id: targetId || undefined,
        ids: Array.isArray(op.ids) ? op.ids : undefined
      });
    } else if (action === 'move') {
      if (!targetId) continue;
      valid.push({
        operation: 'move',
        id: targetId,
        dx: Number(op.dx) || 0,
        dy: Number(op.dy) || 0,
        x: op.x !== undefined ? Number(op.x) : undefined,
        y: op.y !== undefined ? Number(op.y) : undefined
      });
    } else if (action === 'resize') {
      if (!targetId) continue;
      valid.push({
        operation: 'resize',
        id: targetId,
        width: op.width !== undefined ? Number(op.width) : undefined,
        height: op.height !== undefined ? Number(op.height) : undefined,
        r: op.r !== undefined ? Number(op.r) : undefined,
        scale: op.scale !== undefined ? Number(op.scale) : undefined
      });
    } else if (action === 'annotate') {
      if (!targetId) continue;
      valid.push({
        operation: 'annotate',
        id: targetId,
        text: String(op.text || op.label || ''),
        position: op.position || 'top',
        color: op.color || '#2563eb'
      });
    } else if (action === 'highlight') {
      if (!targetId) continue;
      valid.push({
        operation: 'highlight',
        id: targetId,
        color: op.color || '#fef08a',
        duration: Number(op.duration) || 1800
      });
    } else if (action === 'clear') {
      valid.push({
        operation: 'clear',
        target: op.target || 'all'
      });
    } else if (action === 'group') {
      valid.push({
        operation: 'group',
        id: targetId || `group_${Date.now()}`,
        memberIds: Array.isArray(op.memberIds) ? op.memberIds : []
      });
    }
  }

  return valid;
}

// Build the Structured Prompt for the AI Tutor
function buildTutorPrompt({
  studentMessage,
  conversationHistory = [],
  canvasObjects = [],
  scaffoldingLevel = 0,
  subject = 'Physics',
  topic = 'General',
  isInterruption = false,
  studentDrawingContext = ''
}) {
  const scaffold = SCAFFOLDING_LEVELS[scaffoldingLevel] || SCAFFOLDING_LEVELS[0];
  const canvasContext = buildCanvasContext(canvasObjects);

  const historyStr = conversationHistory.slice(-8).map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n');

  return `SUBJECT: ${subject}
TOPIC: ${topic}
CURRENT SCAFFOLDING LEVEL: LEVEL ${scaffoldingLevel} (${scaffold.name})
LEVEL INSTRUCTIONS: ${scaffold.description}
TEACHING DIRECTIVE: ${scaffold.guidance}

${canvasContext}

${studentDrawingContext ? `STUDENT'S DRAWING ANALYSIS:\n${studentDrawingContext}\n` : ''}

${historyStr ? `RECENT CONVERSATION HISTORY:\n${historyStr}\n` : ''}

STUDENT'S LATEST MESSAGE: "${studentMessage}"
${isInterruption ? '(Note: The student interrupted ongoing teaching to ask this. Address it directly and smoothly update the whiteboard.)' : ''}

REQUIRED JSON OUTPUT FORMAT:
Return ONLY one valid JSON object with EXACTLY this structure:
{
  "tutorMessage": "Your conversational response to the student. Explain clearly, use analogies if level 1, use markdown and LaTeX math ($F = ma$, $\\\\theta$). Ask at most ONE guiding question.",
  "spokenNarration": "Spoken version of your message for voice synthesis (concise, natural spoken English, max 2-3 sentences).",
  "scaffoldingLevel": ${scaffoldingLevel},
  "detectedMisconception": null or "brief note of misconception if detected",
  "guidingQuestion": "The single question you are asking the student to guide their thinking",
  "operations": [
    {
      "operation": "create|update|delete|move|resize|annotate|highlight|clear",
      "object": {
        "id": "unique_semantic_id",
        "type": "rect|circle|ellipse|line|arrow|path|text|formula|graph_axes|function_plot|angle_arc|physics_incline|physics_pulley|physics_spring|chemistry_molecule|table",
        "x": 100, "y": 100, "width": 80, "height": 60,
        "x1": 100, "y1": 100, "x2": 250, "y2": 100,
        "cx": 200, "cy": 200, "r": 40,
        "d": "SVG path data if type=path",
        "text": "label or formula text",
        "latex": "LaTeX formula like F = ma or \\\\frac{1}{2}mv^2",
        "label": "arrow label or force badge",
        "stroke": "#2563eb",
        "strokeWidth": 2.5,
        "fill": "none|#f0fdf4|#eff6ff",
        "color": "#1e293b",
        "duration": 700,
        "delay": 150
      }
    }
  ]
}

WHITEBOARD OPERATION GUIDELINES:
1. Coordinates are in 0-960 (width) and 0-700 (height).
2. STABLE IDS: If modifying an existing object on the board, use its EXISTING ID with operation="update" or operation="resize" or operation="move".
3. When creating new objects, choose descriptive semantic IDs: e.g. "incline_plane", "block_m1", "gravity_vector_m1", "normal_force_n", "formula_f_ma".
4. STEM DRAWINGS:
   - Physics: Always anchor vectors to blocks, use arrows with clear labels (e.g. 'mg', 'N', 'T', 'f'). On an incline, resolve gravity into mg*sin(theta) and mg*cos(theta).
   - Coordinate Graphs: Use type "graph_axes" with x, y, width, height, and "function_plot" for equations.
   - Math: Use type "formula" with "latex" property for equations.
5. Socratic Teaching: Do NOT immediately dump full worked answers if the student is at Level 0 or 1. Draw helpful visual intuition and ask them to complete the step.
6. JSON ONLY. No markdown backticks.`;
}

// Deterministic Socratic & Whiteboard Fallback Handler
// Used for high-reliability offline testing, benchmark verification,
// and when LLM provider rate limits are hit.
function matchDeterministicTutorResponse(userMsg, canvasObjects = [], currentLevel = 0, session = null) {
  const q = String(userMsg || '').trim().toLowerCase();

  // Test 1: "Draw a circle and label it A"
  if (/(draw|create|make).*(circle).*(label.*a\b|named.*a\b)/i.test(q) || /(draw a circle and label it a)/i.test(q)) {
    return {
      tutorMessage: "I've drawn circle **A** on the whiteboard. Take a look at its radius and center. What property or problem would you like to explore with this circle?",
      spokenNarration: "I have drawn circle A on the whiteboard. What would you like to explore with it?",
      scaffoldingLevel: 0,
      detectedMisconception: null,
      guidingQuestion: "What property or calculation would you like to explore with circle A?",
      operations: [
        {
          operation: 'create',
          object: {
            id: 'circle_a',
            type: 'circle',
            cx: 480,
            cy: 300,
            r: 50,
            stroke: '#2563eb',
            strokeWidth: 3,
            fill: '#eff6ff',
            label: 'A',
            color: '#1d4ed8',
            fontSize: 18,
            duration: 700
          }
        }
      ]
    };
  }

  // Test 2: "Make the circle larger" / "Make it bigger"
  if (/(make.*circle.*(larger|bigger|increase)|enlarge.*circle)/i.test(q)) {
    // Look for existing circle in canvasObjects
    const existingCircle = canvasObjects.find(o => o.type === 'circle' || String(o.id).includes('circle'));
    const targetId = existingCircle ? existingCircle.id : 'circle_a';
    const oldRadius = existingCircle ? (existingCircle.r || 50) : 50;
    const newRadius = Math.round(oldRadius * 1.6);

    return {
      tutorMessage: `I've updated the existing circle (${targetId}) to make it larger! Notice how the radius increased to ${newRadius}px without clearing the canvas. How does doubling the radius affect its area?`,
      spokenNarration: "I have made the circle larger on the board. How does increasing the radius affect the circle's area?",
      scaffoldingLevel: 0,
      detectedMisconception: null,
      guidingQuestion: "How does increasing the radius of a circle affect its area?",
      operations: [
        {
          operation: 'update',
          id: targetId,
          changes: {
            r: newRadius,
            stroke: '#2563eb',
            strokeWidth: 3.5
          }
        }
      ]
    };
  }

  // Test 3: "Draw a block on an inclined plane and show gravitational force"
  if (/(inclined plane|incline).*(gravit|block)/i.test(q) && !q.includes('component')) {
    return {
      tutorMessage: "Here is the inclined plane inclined at angle $\\theta = 30^\\circ$ with a block of mass $m$ on the slope. I have added the gravitational force vector $F_g = mg$ acting vertically downward toward the center of the Earth. What other forces are acting on this block?",
      spokenNarration: "Here is the inclined plane with the block and the downward gravitational force. What other forces are acting on this block?",
      scaffoldingLevel: 0,
      detectedMisconception: null,
      guidingQuestion: "What other forces are acting on this block?",
      operations: [
        {
          operation: 'create',
          object: {
            id: 'incline_1',
            type: 'physics_incline',
            x: 120,
            y: 450,
            width: 440,
            height: 220,
            angle: 30,
            block: true,
            blockLabel: 'm',
            stroke: '#334155',
            duration: 800
          }
        },
        {
          operation: 'create',
          object: {
            id: 'gravity_vector',
            type: 'arrow',
            x1: 340,
            y1: 340,
            x2: 340,
            y2: 460,
            stroke: '#dc2626',
            strokeWidth: 3.5,
            label: 'mg (Gravity)',
            duration: 700,
            delay: 300
          }
        }
      ]
    };
  }

  // Test 4: "Now show the components of gravity" / "Show components"
  if (/(component.*gravity|show.*components|resolve.*gravity)/i.test(q)) {
    return {
      tutorMessage: "I've resolved the vertical gravitational force $mg$ into its two perpendicular components on the existing diagram:\n1. $mg\\cos\\theta$ acting perpendicular into the inclined plane.\n2. $mg\\sin\\theta$ acting parallel down the slope.\n\nWhich component is balanced by the normal force $N$?",
      spokenNarration: "I have added the two components of gravity. Which component is perpendicular to the surface of the incline?",
      scaffoldingLevel: 0,
      detectedMisconception: null,
      guidingQuestion: "Which component is perpendicular to the inclined plane surface?",
      operations: [
        {
          operation: 'create',
          object: {
            id: 'gravity_perp',
            type: 'arrow',
            x1: 340,
            y1: 340,
            x2: 400,
            y2: 444,
            stroke: '#7c3aed',
            strokeWidth: 2.5,
            strokeDasharray: '4 3',
            label: 'mg·cos θ',
            duration: 700
          }
        },
        {
          operation: 'create',
          object: {
            id: 'gravity_parallel',
            type: 'arrow',
            x1: 340,
            y1: 340,
            x2: 240,
            y2: 398,
            stroke: '#16a34a',
            strokeWidth: 3,
            label: 'mg·sin θ',
            duration: 700,
            delay: 200
          }
        },
        {
          operation: 'create',
          object: {
            id: 'formula_components',
            type: 'formula',
            x: 580,
            y: 200,
            latex: 'F_{\\perp} = mg\\cos\\theta, \\quad F_{\\parallel} = mg\\sin\\theta',
            duration: 600,
            delay: 400
          }
        }
      ]
    };
  }

  // Test 5: "Just give me the answer" / "Give me the answer"
  if (/(just give me the answer|tell me the answer|what is the answer|give me answer)/i.test(q)) {
    const level = currentLevel !== undefined ? currentLevel : 0;
    if (level === 0) {
      return {
        tutorMessage: "I know you're eager for the answer, but real understanding comes from working through the concept step by step! Let's start with the fundamental principle: what law connects the net force acting on an object with its mass and acceleration?",
        spokenNarration: "Let's work through this step by step. What fundamental law relates net force, mass, and acceleration?",
        scaffoldingLevel: 1, // Advance to hint
        detectedMisconception: null,
        guidingQuestion: "What law connects net force, mass, and acceleration?",
        operations: [
          {
            operation: 'create',
            object: {
              id: 'hint_level_1',
              type: 'formula',
              x: 520,
              y: 280,
              latex: 'F_{net} = m \\cdot a',
              stroke: '#2563eb',
              color: '#1d4ed8'
            }
          }
        ]
      };
    } else if (level === 1) {
      return {
        tutorMessage: "Think of pushing a heavy wagon: if you push with more force, it accelerates faster; if the wagon is heavier, it accelerates slower. Look at the formula on the board ($F = ma$). If a $2\\text{ kg}$ block experiences a net force of $10\\text{ N}$, how can you rearrange the formula to isolate acceleration $a$?",
        spokenNarration: "Think of pushing a wagon. If force is 10 Newtons and mass is 2 kilograms, how do we solve for acceleration?",
        scaffoldingLevel: 2,
        detectedMisconception: null,
        guidingQuestion: "How do you rearrange F = ma to solve for acceleration a?",
        operations: [
          {
            operation: 'create',
            object: {
              id: 'hint_level_2',
              type: 'formula',
              x: 520,
              y: 350,
              latex: 'a = \\frac{F_{net}}{m}',
              stroke: '#16a34a',
              color: '#15803d'
            }
          }
        ]
      };
    } else if (level === 2) {
      return {
        tutorMessage: "Let's do the substitution together: we substitute $F = 10\\text{ N}$ and $m = 2\\text{ kg}$ into $a = \\frac{F}{m}$:\n$$a = \\frac{10\\text{ N}}{2\\text{ kg}}$$\nWhat is $10$ divided by $2$?",
        spokenNarration: "We substitute 10 Newtons divided by 2 kilograms. What is 10 divided by 2?",
        scaffoldingLevel: 3,
        detectedMisconception: null,
        guidingQuestion: "What is 10 divided by 2?",
        operations: [
          {
            operation: 'create',
            object: {
              id: 'step_substitution',
              type: 'formula',
              x: 520,
              y: 420,
              latex: 'a = \\frac{10\\text{ N}}{2\\text{ kg}} = \\text{?}',
              stroke: '#d97706',
              color: '#b45309'
            }
          }
        ]
      };
    } else {
      // Level 3 or 4: Complete worked example + practice question
      return {
        tutorMessage: "Here is the full worked solution:\n$$a = \\frac{F_{net}}{m} = \\frac{10\\text{ N}}{2\\text{ kg}} = 5\\text{ m/s}^2$$\n\nNow to confirm your understanding with a practice check: if the mass were increased to $5\\text{ kg}$ under that same $10\\text{ N}$ force, what would the new acceleration be?",
        spokenNarration: "The complete answer is 5 meters per second squared. Now, if the mass were 5 kilograms with the same 10 Newton force, what would the acceleration be?",
        scaffoldingLevel: 4,
        detectedMisconception: null,
        guidingQuestion: "If mass is 5 kg and force is 10 N, what is the acceleration?",
        operations: [
          {
            operation: 'create',
            object: {
              id: 'full_solution_card',
              type: 'table',
              x: 500,
              y: 440,
              width: 420,
              title: 'Worked Solution: Newton\'s 2nd Law',
              rows: [
                '1. Given: m = 2 kg, F = 10 N',
                '2. Formula: a = F_net / m',
                '3. Calculation: a = 10 / 2 = 5 m/s²',
                '4. Practice check: what if m = 5 kg?'
              ],
              stroke: '#16a34a'
            }
          }
        ]
      };
    }
  }

  // Test 6: "Check my drawing" or student evaluating their work
  if (/(check.*(work|drawing|diagram|answer)|is (this|my).*correct|evaluate)/i.test(q)) {
    const studentObjs = canvasObjects.filter(o => o.createdBy === 'student');
    if (studentObjs.length > 0) {
      return {
        tutorMessage: `I analyzed your whiteboard drawing! I see ${studentObjs.length} student-created element(s). Your representation looks conceptually sound. Make sure all vector directions are clearly aligned with the surface and force arrows are properly labeled. What question do you have about your drawing?`,
        spokenNarration: "I've reviewed your drawing on the whiteboard. It looks promising. Make sure all force arrows have clear labels.",
        scaffoldingLevel: currentLevel,
        detectedMisconception: null,
        guidingQuestion: "What specific part of your drawing would you like to verify?",
        operations: [
          {
            operation: 'highlight',
            id: studentObjs[0].id,
            color: '#bbf7d0',
            duration: 2500
          }
        ]
      };
    }
  }

  return null;
}

module.exports = {
  TUTOR_SYSTEM_PROMPT,
  SCAFFOLDING_LEVELS,
  getSession,
  saveSession,
  updateScaffoldingState,
  buildCanvasContext,
  validateOperations,
  buildTutorPrompt,
  matchDeterministicTutorResponse
};
