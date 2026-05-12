const preEnv = process.env.GEMINI_API_KEY;
import "dotenv/config";
const postEnv = process.env.GEMINI_API_KEY;

console.log("Before dotenv:");
console.log(`GEMINI_API_KEY defined: ${preEnv !== undefined}`);
console.log(`GEMINI_API_KEY value length: ${preEnv?.length ?? 0}`);

console.log("\nAfter dotenv:");
console.log(`GEMINI_API_KEY defined: ${postEnv !== undefined}`);
console.log(`GEMINI_API_KEY value length: ${postEnv?.length ?? 0}`);
