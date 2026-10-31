# Image-to-Canvas Context Update

This update improves the existing document/image-to-whiteboard handoff without replacing the whiteboard engine or changing its drawing-operation format.

## Changes

- `lib/docs-api.js`: asks the vision model to inspect the complete image, identify visual structures and relationships, and return a longer grounded context plus teachable topics. Cache keys now hash the complete attachment to avoid collisions between images.
- `public/docs.js`: retains extracted visual context, creates an image attachment from the selected region (or the full image when no region is selected), and hands that attachment to the existing Canvas upload flow.
- `public/whiteboard-init.js`: uses the expanded document context when the learner starts the lesson from a document topic.
- `server.js`: makes the attached-image lesson prompt subject-neutral and grounded in the actual upload, while retaining specific-question solving instructions when applicable.
- `dist/docs.js` and `dist/whiteboard-init.js`: synchronized with the updated public assets because the bundled server serves the `dist` directory.

## Preserved

- Whiteboard engine and drawing-operation schema
- PDF rendering/viewer engine
- Session and navigation systems
- Existing lesson endpoints and request structure

## Verification

- JavaScript syntax checks passed for all modified JavaScript files.
- AI tutor tests: 10 passed, 0 failed.
- HTTP integration tests: 5 passed, 0 failed (run using the host Node executable because the bundled `runtime/node.exe` is a Windows executable and cannot run in this Linux build environment).
- A focused mocked test of the image-context extraction contract passed.

A live multimodal API test was not run because it requires the user's configured API key and network/API access.
