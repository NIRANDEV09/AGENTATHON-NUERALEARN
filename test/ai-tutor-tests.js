// Comprehensive Automated Test Suite for NeuraLearn AI Tutor & Interactive Whiteboard
// Covers all 10 Phase 13 Test Scenarios:
// 1. Basic AI drawing
// 2. Modify an existing shape by ID without recreating
// 3. Multi-step diagram (incline, block, gravity vector)
// 4. Follow-up context (add gravity components without resetting)
// 5. Socratic teaching & adaptive scaffolding progression (levels 0 -> 4)
// 6. Student drawing analysis & confidence-aware evaluation
// 7. Session persistence & state recovery
// 8. Sequential / concurrent operation queue execution & duplicate protection
// 9. Malformed operation safety & validation rejection
// 10. Student interruption handling

const assert = require('assert');
const {
  TUTOR_SYSTEM_PROMPT,
  SCAFFOLDING_LEVELS,
  getSession,
  saveSession,
  updateScaffoldingState,
  buildCanvasContext,
  validateOperations,
  buildTutorPrompt,
  matchDeterministicTutorResponse
} = require('../lib/ai-tutor-service.js');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

console.log('====================================================');
console.log('NEURALEARN AI TUTOR & INTERACTIVE WHITEBOARD TESTS');
console.log('====================================================\n');

// ---------------------------------------------------------------------------
// TEST 1: Basic AI Drawing
// ---------------------------------------------------------------------------
runTest('TEST 1: Basic AI Drawing (create circle labeled A)', () => {
  const userMsg = 'Draw a circle and label it A';
  const res = matchDeterministicTutorResponse(userMsg, [], 0);
  assert(res !== null, 'Response should not be null');
  assert(Array.isArray(res.operations), 'Operations should be an array');
  assert.strictEqual(res.operations.length, 1, 'Should have exactly 1 operation');

  const op = res.operations[0];
  assert.strictEqual(op.operation, 'create', 'Operation must be create');
  assert.strictEqual(op.object.type, 'circle', 'Object type must be circle');
  assert.strictEqual(op.object.label, 'A', 'Object label must be A');
  assert(op.object.r > 0, 'Circle radius must be positive');
  assert(res.tutorMessage.includes('circle'), 'Tutor message should mention the circle');
});

// ---------------------------------------------------------------------------
// TEST 2: Modify an Existing Shape
// ---------------------------------------------------------------------------
runTest('TEST 2: Modify existing shape by ID without creating duplicate', () => {
  const initialCanvas = [
    { id: 'circle_a', type: 'circle', cx: 480, cy: 300, r: 50, label: 'A' }
  ];
  const userMsg = 'Make the circle larger';
  const res = matchDeterministicTutorResponse(userMsg, initialCanvas, 0);

  assert(res !== null, 'Response should not be null');
  const op = res.operations[0];
  assert.strictEqual(op.operation, 'update', 'Must be update operation, NOT create');
  assert.strictEqual(op.id, 'circle_a', 'Must target existing circle_a ID');
  assert(op.changes.r > 50, 'New radius must be larger than original 50px');
  assert(!res.operations.some(o => o.operation === 'clear'), 'Must NOT clear the board');
});

// ---------------------------------------------------------------------------
// TEST 3: Multi-step Diagram
// ---------------------------------------------------------------------------
runTest('TEST 3: Multi-step diagram (incline plane, block, gravity vector)', () => {
  const userMsg = 'Draw a block on an inclined plane and show gravitational force';
  const res = matchDeterministicTutorResponse(userMsg, [], 0);

  assert(res !== null, 'Response should not be null');
  assert(res.operations.length >= 2, 'Should create incline and gravity vector');

  const inclineOp = res.operations.find(o => o.object.type === 'physics_incline');
  const gravityOp = res.operations.find(o => o.object.type === 'arrow');

  assert(inclineOp !== undefined, 'Incline plane must be created');
  assert(inclineOp.object.block === true, 'Block must be placed on incline');
  assert(gravityOp !== undefined, 'Gravity vector must be created');
  assert(gravityOp.object.y2 > gravityOp.object.y1, 'Gravity vector must point vertically downward');
});

// ---------------------------------------------------------------------------
// TEST 4: Follow-up Context
// ---------------------------------------------------------------------------
runTest('TEST 4: Follow-up context (add components without resetting canvas)', () => {
  const existingCanvas = [
    { id: 'incline_1', type: 'physics_incline', angle: 30, block: true },
    { id: 'gravity_vector', type: 'arrow', label: 'mg' }
  ];
  const userMsg = 'Now show the components of gravity';
  const res = matchDeterministicTutorResponse(userMsg, existingCanvas, 0);

  assert(res !== null, 'Response should not be null');
  assert(!res.operations.some(o => o.operation === 'clear'), 'Must NOT clear existing canvas');

  const perpOp = res.operations.find(o => String(o.object.label).includes('cos'));
  const parallelOp = res.operations.find(o => String(o.object.label).includes('sin'));

  assert(perpOp !== undefined, 'Must create mg cos theta perpendicular component');
  assert(parallelOp !== undefined, 'Must create mg sin theta parallel component');
});

// ---------------------------------------------------------------------------
// TEST 5: Socratic Teaching & Adaptive Scaffolding Progression (Levels 0-4)
// ---------------------------------------------------------------------------
runTest('TEST 5: Socratic teaching and scaffolding progression (Levels 0-4)', () => {
  // Level 0: Ask guiding question, do not reveal solution
  const res0 = matchDeterministicTutorResponse('Just give me the answer', [], 0);
  assert(res0.scaffoldingLevel === 1, 'Should progress from Level 0 to Level 1 hint');
  assert(!res0.tutorMessage.includes('5 m/s²'), 'Must NOT reveal final numerical answer at level 0');
  assert(res0.guidingQuestion.length > 0, 'Must ask a single guiding question');

  // Level 1: Analogy & formula hint
  const res1 = matchDeterministicTutorResponse('Just give me the answer', [], 1);
  assert(res1.scaffoldingLevel === 2, 'Should progress to Level 2 micro-steps');
  assert(res1.tutorMessage.includes('wagon') || res1.tutorMessage.includes('push'), 'Should provide real-world analogy');

  // Level 2: Substitution step
  const res2 = matchDeterministicTutorResponse('Just give me the answer', [], 2);
  assert(res2.scaffoldingLevel === 3, 'Should progress to Level 3 partial solution');
  assert(res2.tutorMessage.includes('10'), 'Should substitute known numbers');

  // Level 3/4: Full solution with practice check
  const res3 = matchDeterministicTutorResponse('Just give me the answer', [], 3);
  assert.strictEqual(res3.scaffoldingLevel, 4, 'Must reach Level 4 full worked solution');
  assert(res3.tutorMessage.includes('5') && res3.tutorMessage.includes('m/s'), 'Must include worked solution');
  assert(res3.tutorMessage.includes('practice') || res3.guidingQuestion.includes('practice') || res3.guidingQuestion.includes('5 kg'), 'Must include practice check');
});

// ---------------------------------------------------------------------------
// TEST 6: Student Drawing Analysis & Confidence-Aware Evaluation
// ---------------------------------------------------------------------------
runTest('TEST 6: Student drawing analysis with confidence awareness', () => {
  const canvasWithStudentWork = [
    { id: 'incline_1', type: 'physics_incline', createdBy: 'ai' },
    { id: 'student_arrow_1', type: 'arrow', label: 'N', createdBy: 'student' }
  ];
  const userMsg = 'Is my drawing correct?';
  const res = matchDeterministicTutorResponse(userMsg, canvasWithStudentWork, 0);

  assert(res !== null, 'Response should not be null');
  assert(res.tutorMessage.includes('student-created') || res.tutorMessage.includes('drawing'), 'Must reference student drawing');
  const highlightOp = res.operations.find(o => o.operation === 'highlight');
  assert(highlightOp !== undefined, 'Must highlight the student object');
  assert.strictEqual(highlightOp.id, 'student_arrow_1', 'Must highlight the student ID');
});

// ---------------------------------------------------------------------------
// TEST 7: Persistence
// ---------------------------------------------------------------------------
runTest('TEST 7: Session persistence and recovery', () => {
  const testSessionId = 'test_session_' + Date.now();
  const session = getSession(testSessionId);
  session.subject = 'Physics';
  session.topic = "Newton's Second Law";
  session.scaffoldingLevel = 2;
  session.canvasObjects = [
    { id: 'block_1', type: 'rect', x: 200, y: 300, width: 80, height: 60, createdBy: 'ai' },
    { id: 'student_fbd', type: 'arrow', x1: 240, y1: 300, x2: 240, y2: 200, createdBy: 'student' }
  ];
  saveSession(session);

  // Reload session
  const reloaded = getSession(testSessionId);
  assert.strictEqual(reloaded.sessionId, testSessionId, 'Session ID must match');
  assert.strictEqual(reloaded.scaffoldingLevel, 2, 'Scaffolding level must persist');
  assert.strictEqual(reloaded.canvasObjects.length, 2, 'Canvas objects must persist');
  assert.strictEqual(reloaded.canvasObjects[1].createdBy, 'student', 'Student ownership must persist');
});

// ---------------------------------------------------------------------------
// TEST 8: Concurrent / Sequential Operations Queue Execution
// ---------------------------------------------------------------------------
runTest('TEST 8: Sequential operation queue and duplicate ID protection', () => {
  const rawOps = [
    { operation: 'create', object: { id: 'obj_1', type: 'rect', x: 100, y: 100, width: 50, height: 50 } },
    { operation: 'create', object: { id: 'obj_1', type: 'circle', cx: 200, cy: 200, r: 30 } }, // duplicate ID!
    { operation: 'create', object: { id: 'obj_2', type: 'arrow', x1: 50, y1: 50, x2: 150, y2: 50 } }
  ];

  const validated = validateOperations(rawOps);
  assert.strictEqual(validated.length, 3, 'All 3 operations should be validated');

  // Verify duplicate ID was sanitized with a unique fallback ID
  const id0 = validated[0].object.id;
  const id1 = validated[1].object.id;
  assert.notStrictEqual(id0, id1, 'Duplicate ID must be automatically remapped to a unique ID');
});

// ---------------------------------------------------------------------------
// TEST 9: Malformed Operation Safety & Validation
// ---------------------------------------------------------------------------
runTest('TEST 9: Malformed operation rejection without crashing', () => {
  const malformedOps = [
    null,
    undefined,
    {},
    'invalid string',
    { operation: 'unknown_fake_op' },
    { operation: 'update' }, // missing id!
    { operation: 'delete' }, // missing id!
    { operation: 'create', object: { type: 'rect', x: 'invalid_number' } }
  ];

  const validated = validateOperations(malformedOps);
  // Validated array should safely exclude invalid update/delete without ID and sanitize NaN
  const createOp = validated.find(o => o.operation === 'create');
  assert(createOp !== undefined, 'Create op should be preserved with sanitized defaults');
  assert.strictEqual(createOp.object.x, 0, 'Invalid number coordinate must safely default to 0 without NaN');
});

// ---------------------------------------------------------------------------
// TEST 10: Student Interruption Handling
// ---------------------------------------------------------------------------
runTest('TEST 10: Student interruption handling & context preservation', () => {
  const canvasBeforeInterrupt = [
    { id: 'pulley_1', type: 'physics_pulley', x: 300, y: 200 },
    { id: 'mass_1', type: 'rect', x: 200, y: 350, label: 'm1' }
  ];

  const contextStr = buildCanvasContext(canvasBeforeInterrupt);
  assert(contextStr.includes('pulley_1'), 'Context must preserve existing pulley');
  assert(contextStr.includes('mass_1'), 'Context must preserve existing mass');

  const prompt = buildTutorPrompt({
    studentMessage: 'Wait, why is tension the same on both sides?',
    conversationHistory: [],
    canvasObjects: canvasBeforeInterrupt,
    scaffoldingLevel: 1,
    isInterruption: true
  });

  assert(prompt.includes('student interrupted ongoing teaching'), 'Prompt must indicate interruption flag');
  assert(prompt.includes('pulley_1'), 'Prompt must maintain active canvas context');
});

console.log('\n====================================================');
console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');

if (failed > 0) process.exit(1);
