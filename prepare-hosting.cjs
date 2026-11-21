const { copyFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const assets = [
  "index.html", "tracker.html", "cloud.js", "firebase-config.js", "sw.js", "manifest.json",
  "vendor/firebase-app-compat.js", "vendor/firebase-auth-compat.js",
  "vendor/firebase-firestore-compat.js", "vendor/LICENSE",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png",
  "icons/icon-512.png", "icons/icon-1024.png"
];
for (const asset of assets) {
  const destination = join(__dirname, ".hosting-build", asset);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(__dirname, asset), destination);
}
