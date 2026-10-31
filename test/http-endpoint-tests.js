// HTTP Integration Test for NeuraLearn Endpoints
// Spins up server.js on a test port and verifies:
// 1. GET /api/health
// 2. POST /api/tutor/chat
// 3. POST /api/tutor/vision
// 4. GET /api/tutor/session
// 5. POST /api/tutor/session

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

const TEST_PORT = 3105;

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') });
        } catch (_) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: 'localhost',
      port: TEST_PORT,
      path: urlPath
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') });
        } catch (_) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
  });
}

async function main() {
  console.log(`Starting server on port ${TEST_PORT}...`);
  const env = { ...process.env, PORT: String(TEST_PORT), NEURA_VIDEO_SERVER: '0' };
  const srv = spawn(path.join(__dirname, '..', 'runtime', 'node.exe'), [path.join(__dirname, '..', 'server.js')], { env });

  srv.stdout.on('data', d => process.stdout.write('[Server] ' + d.toString()));
  srv.stderr.on('data', d => process.stderr.write('[Server Error] ' + d.toString()));

  // Wait for server to start listening
  await new Promise(r => setTimeout(r, 2000));

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
      failed++;
    }
  }

  try {
    // 1. Health check
    await check('Endpoint GET /api/health', async () => {
      const res = await get('/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });

    // 2. Tutor chat - basic drawing
    await check('Endpoint POST /api/tutor/chat (Draw circle A)', async () => {
      const res = await post('/api/tutor/chat', {
        sessionId: 'http_test_1',
        message: 'Draw a circle and label it A',
        canvasState: []
      });
      assert.strictEqual(res.status, 200);
      assert(res.body.tutorMessage.length > 0);
      assert(res.body.operations.length >= 1);
      assert.strictEqual(res.body.operations[0].object.type, 'circle');
      assert.strictEqual(res.body.operations[0].object.label, 'A');
    });

    // 3. Tutor chat - modify existing
    await check('Endpoint POST /api/tutor/chat (Modify existing circle)', async () => {
      const res = await post('/api/tutor/chat', {
        sessionId: 'http_test_1',
        message: 'Make the circle larger',
        canvasState: [
          { id: 'circle_a', type: 'circle', cx: 480, cy: 300, r: 50, label: 'A' }
        ]
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.operations[0].operation, 'update');
      assert.strictEqual(res.body.operations[0].id, 'circle_a');
      assert(res.body.operations[0].changes.r > 50);
    });

    // 4. Session save and load
    await check('Endpoint POST & GET /api/tutor/session', async () => {
      const saveRes = await post('/api/tutor/session', {
        sessionId: 'http_test_session',
        subject: 'Mathematics',
        scaffoldingLevel: 1,
        canvasObjects: [{ id: 'math_1', type: 'formula', latex: 'x^2 + y^2 = r^2' }]
      });
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.body.ok, true);

      const getRes = await get('/api/tutor/session?id=http_test_session');
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.sessionId, 'http_test_session');
      assert.strictEqual(getRes.body.scaffoldingLevel, 1);
      assert.strictEqual(getRes.body.canvasObjects.length, 1);
    });

    // 5. Vision endpoint
    await check('Endpoint POST /api/tutor/vision', async () => {
      // 1x1 white pixel PNG data URL
      const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const res = await post('/api/tutor/vision', {
        canvasSnapshot: samplePng,
        prompt: 'Check my work'
      });
      assert.strictEqual(res.status, 200);
      assert(res.body.confidence !== undefined);
      assert(res.body.feedback !== undefined);
    });

    console.log(`\nHTTP Integration Tests: ${passed} PASSED, ${failed} FAILED`);
  } finally {
    srv.kill();
  }

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

