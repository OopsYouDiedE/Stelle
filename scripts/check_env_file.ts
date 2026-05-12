import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
console.log(`Checking file: ${envPath}`);

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const geminiLine = lines.find(l => l.startsWith('GEMINI_API_KEY='));
  
  if (geminiLine) {
    const value = geminiLine.split('=')[1]?.trim();
    console.log(`Found GEMINI_API_KEY in file.`);
    console.log(`Value length: ${value?.length ?? 0}`);
    if (value && value.length > 0) {
        console.log(`First 2 chars: ${value.substring(0, 2)}...`);
    } else {
        console.log(`Value is empty in file.`);
    }
  } else {
    console.log(`GEMINI_API_KEY not found in file.`);
  }
} else {
  console.log(`.env file does not exist at expected path.`);
}

import "dotenv/config";
console.log(`\nFinal process.env.GEMINI_API_KEY length: ${process.env.GEMINI_API_KEY?.length ?? 0}`);
