/**
 * Test environment guard.
 *
 * Runs before the test file (and therefore before `../app.js` is imported and
 * `src/config.ts` is evaluated): the integration suite must stay hermetic, so
 * it always exercises the labelled deterministic path instead of calling the
 * live Gemini API with whatever key happens to be configured on the machine.
 */

process.env.AI_PROVIDER = "deterministic";
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.MODEL_API_KEY;
delete process.env.META_API_KEY;
