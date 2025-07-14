#!/usr/bin/env node

// cli.js
const convertHtmlToMarkdown = require("./index");
const path = require("path");

// 命令行参数解析
const args = process.argv.slice(2);
let url, outputPath;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" && args[i + 1]) {
    outputPath = path.resolve(args[i + 1]);
    i++;
  } else if (!url) {
    url = args[i];
  }
}

if (!url || !outputPath) {
  console.error("Usage: html2md <url> -o <output-file>");
  process.exit(1);
}

(async () => {
  try {
    await convertHtmlToMarkdown(url, outputPath);
    process.exit(0);
  } catch (error) {
    console.error("Conversion failed.");
    process.exit(1);
  }
})();
