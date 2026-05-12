import "dotenv/config";
console.log("Keys in process.env:");
Object.keys(process.env).filter(k => k.includes("API_KEY") || k.includes("GEMINI")).forEach(k => {
  const val = process.env[k];
  let status = "undefined";
  if (val !== undefined) {
    status = val === "" ? "empty string" : "has value";
  }
  console.log(`${k}: ${status}`);
});
