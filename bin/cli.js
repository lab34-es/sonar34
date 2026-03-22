#!/usr/bin/env node

const { startServer } = await import('../backend/server.js');

const { port } = await startServer();

const url = `http://localhost:${port}`;
console.log(`\n  sonar34 running at ${url}\n`);

// Auto-open the browser
try {
  const open = (await import('open')).default;
  await open(url);
} catch {
  // Silently fail if browser can't be opened (e.g. headless server)
}
