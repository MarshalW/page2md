// index.js
const puppeteer = require("puppeteer");
const TurndownService = require("turndown");
const { JSDOM } = require("jsdom");
const { promisify } = require("util");

const wait = promisify(setTimeout);

/**
 * 将给定URL的HTML内容转换为Markdown。
 * @param {Object} config - 配置对象
 * @param {string} config.url - 要转换的网页URL
 * @param {Object} [config.options] - 可选配置
 * @param {number} [config.options.timeout=30000] - 页面加载最大等待时间（毫秒）
 * @param {boolean} [config.options.disableJavaScript=false] - 是否禁用JavaScript执行
 * @returns {Promise<string>} - 转换后的Markdown内容
 */
async function convertHtmlToMarkdown({
  url,
  options = { timeout: 30000, disableJavaScript: false },
} = {}) {
  const { timeout = 30000, disableJavaScript = false } = options;

  if (!url) {
    throw new Error("URL is required");
  }

  let browser;
  try {
    // 启动浏览器
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    // 设置浏览器视口和User-Agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    // 禁用JavaScript（如果指定了disableJavaScript）
    if (disableJavaScript) {
      await page.setJavaScriptEnabled(false);
      console.log("JavaScript execution disabled for static content");
    }

    // 导航到目标URL
    console.log(`Loading: ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    // 更健壮的内容等待策略（仅在未禁用JavaScript时执行）
    if (!disableJavaScript) {
      console.log("Waiting for dynamic content...");
      await waitForContent(page);
    }

    // 获取页面HTML内容
    const htmlContent = await page.content();

    // 使用 JSDOM 解析 HTML
    const dom = new JSDOM(htmlContent, { url });
    const document = dom.window.document;

    console.log("Extracting article content...");
    const article = extractContent(document);

    if (!article || !article.content) {
      throw new Error("Failed to extract article content");
    }

    // 转换HTML为Markdown
    console.log("Converting to Markdown...");
    const turndownService = createTurndownService();
    let markdown = turndownService.turndown(article.content);

    // 清理多余的换行
    markdown = cleanMarkdown(markdown);

    // 返回Markdown内容
    return `# ${article.title}\n\n${markdown}`;
  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error; // 重新抛出错误，让调用者处理
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 以下辅助函数保持不变，但不再导出，因为它们是 convertHtmlToMarkdown 的内部实现细节。

async function waitForContent(page) {
  const selectorsToTry = [".doc-content", "article", "main", ".content", "h1"];

  let foundSelector = null;

  for (const selector of selectorsToTry) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      foundSelector = selector;
      console.log(`Found content using selector: ${selector}`);
      break;
    } catch (e) {
      console.log(`Selector ${selector} not found within 5 seconds`);
    }
  }

  if (!foundSelector) {
    console.log("No selector found, trying text-based detection");
    try {
      await page.waitForFunction(
        () => document.querySelector("body")?.textContent?.length > 500,
        { timeout: 10000 }
      );
      console.log("Detected sufficient text content");
    } catch (e) {
      console.log("Text content detection failed, continuing anyway");
    }
  }

  await autoScroll(page);
  await wait(1000);
}

function extractContent(document) {
  const title =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector("h1")?.textContent ||
    "Untitled";

  let contentElement = document.querySelector(".doc-content");
  if (!contentElement) contentElement = document.querySelector("article");
  if (!contentElement) contentElement = document.querySelector("main");
  if (!contentElement) contentElement = document.querySelector(".content");

  if (!contentElement) {
    console.warn("Main content area not found, using entire body");
    contentElement = document.body;
  }

  const contentClone = contentElement.cloneNode(true);

  const elementsToRemove = [
    ".header-anchor",
    ".sidebar",
    ".toc",
    ".footer",
    ".edit-link",
    "nav",
    "script",
    "style",
    "iframe",
    ".page-meta",
    ".ads-container",
    ".comment-section",
  ];

  elementsToRemove.forEach((selector) => {
    const elements = contentClone.querySelectorAll(selector);
    elements.forEach((el) => el.remove());
  });

  return {
    title,
    content: contentClone.innerHTML,
  };
}

function createTurndownService() {
  const turndownService = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    escape: (text) => text,
  });

  turndownService.addRule("pre", {
    filter: ["pre"],
    replacement: (content, node) => {
      const codeNode = node.querySelector("code");
      let language = "";
      if (codeNode) {
        const langMatch = codeNode.className.match(/language-(\w+)/);
        language = langMatch ? langMatch[1] : "";
      }
      return `\n\`\`\`${language}\n${content}\n\`\`\`\n`;
    },
  });

  turndownService.addRule("code", {
    filter: ["code"],
    replacement: (content, node) => {
      if (node.closest("pre")) return content;
      return `\`${node.textContent}\``;
    },
  });

  turndownService.addRule("img", {
    filter: "img",
    replacement: (content, node) => {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    },
  });

  turndownService.addRule("tables", {
    filter: ["table"],
    replacement: (content, node) => {
      const rows = Array.from(node.querySelectorAll("tr"));
      const markdownRows = rows.map((row) => {
        const cells = Array.from(row.querySelectorAll("td, th"));
        return cells
          .map((cell) => {
            const text = turndownService
              .turndown(cell.innerHTML)
              .replace(/\n/g, " ");
            return cell.tagName.toLowerCase() === "th" ? `**${text}**` : text;
          })
          .join(" | ");
      });

      if (rows.length > 0) {
        const headerSeparator = "---|"
          .repeat(rows[0].querySelectorAll("td, th").length)
          .slice(0, -1);
        markdownRows.splice(1, 0, headerSeparator);
      }

      return `\n${markdownRows.join("\n")}\n\n`;
    },
  });

  turndownService.addRule("admonition", {
    filter: (node) => {
      return (
        node.nodeName === "DIV" &&
        (node.className.includes("warning") ||
          node.className.includes("tip") ||
          node.className.includes("note"))
      );
    },
    replacement: (content, node) => {
      const type = node.className.includes("warning")
        ? "⚠️ WARNING"
        : node.className.includes("tip")
        ? "💡 TIP"
        : "ℹ️ NOTE";
      return `\n> **${type}**\n> ${content.trim().replace(/\n/g, "\n> ")}\n\n`;
    },
  });

  return turndownService;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 200;
      const scrollDelay = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, scrollDelay);
    });
  });
}

function cleanMarkdown(markdown) {
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.replace(/(\n{2,})(```)/g, "\n$2");
  markdown = markdown.replace(/(```)(\n{2,})/g, "$1\n");
  markdown = markdown.replace(/(\n{2,})([-*] )/g, "\n$2");
  markdown = markdown.replace(/([-*].+)(\n{2,})/g, "$1\n");
  markdown = markdown.replace(/\\`/g, "`");
  markdown = markdown.replace(/\\#/g, "#");
  markdown = markdown.replace(/\\-/g, "-");
  return markdown;
}

// 导出主函数
module.exports = {
  convert: convertHtmlToMarkdown,
};
