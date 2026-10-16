import { defineConfig } from 'vitest/config';

// Most tests start the CLI or load the tokenizer, which takes seconds on a busy machine or a slow
// CI runner. The work is slow, not stuck, so every test gets a long timeout.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
});
