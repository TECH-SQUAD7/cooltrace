import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { createApp } = await import('./app.js');
const { isConfigured } = await import('./gemini.js');

const port = Number(process.env.PORT) || 8787;
createApp().listen(port, () => {
  console.log(`COOLTRACE API listening on http://localhost:${port}`);
  console.log(isConfigured() ? 'Gemini: configured' : 'Gemini: NOT configured - set GEMINI_API_KEY in server/.env (AI features disabled)');
});
