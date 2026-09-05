import path from 'node:path';
import dotenv from 'dotenv';

// Load the dedicated test environment BEFORE any src/lib module is imported
// (src/lib/env.ts validates process.env at import time).
dotenv.config({ path: path.resolve(__dirname, '..', '.env.test') });
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';
