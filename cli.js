#!/usr/bin/env node

// cli.js
const { program } = require("commander");
const { convert } = require("./index");
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

// Configure commander
program
  .version(packageJson.version, "-v, --version", "Output the current version")
  .argument("<url>", "URL of the webpage to convert")
  .requiredOption("-o, --output <output-file>", "Output Markdown file path")
  .option(
    "-t, --timeout <ms>",
    "Set the maximum time to wait for page loading (in milliseconds)",
    "30000"
  )
  .option("--no-js", "Disable JavaScript execution for static content only")
  .action(async (url, options) => {
    const outputPath = path.resolve(options.output);
    const timeout = parseInt(options.timeout, 10);
    const disableJavaScript = options.noJs || false;

    try {
      const markdown = await convert({
        url,
        options: { timeout, disableJavaScript },
      });
      fs.writeFileSync(outputPath, markdown);
      console.log(`✅ Markdown saved to ${outputPath}`);
      process.exit(0);
    } catch (error) {
      console.error("❌ Conversion failed:", error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
