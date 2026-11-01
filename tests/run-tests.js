"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SAVE_KEY = "investmentEmpireSave";
const MAX_SAFE_MONEY = 1e15;
const MAX_QUANTITY = 1e9;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

const results = { passed: 0, failed: 0, failures: [] };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || "assertEqual") +
        ": expected " +
        JSON.stringify(expected) +
        ", got " +
        JSON.stringify(actual),
    );
  }
}

function assertClose(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      (message || "assertClose") +
        ": expected " +
        expected +
        " +/- " +
        tolerance +
        ", got " +
        actual,
    );
  }
}

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log("PASS " + name);
  } catch (error) {
    results.failed += 1;
    results.failures.push({ name, error });
    console.log("FAIL " + name + " -> " + error.message);
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      let requestPath;
      try {
        requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
      } catch (error) {
        response.writeHead(400);
        response.end("Bad request");
        return;
      }
      if (requestPath === "/") requestPath = "/index.html";
      const filePath = path.resolve(ROOT, "." + requestPath);
      if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type":
            MIME_TYPES[path.extname(filePath).toLowerCase()] ||
            "application/octet-stream",
          "Cache-Control": "no-store",
        });
        response.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(portFile)) {
      const contents = fs.readFileSync(portFile, "utf8").split(/\r?\n/);
      const port = Number(contents[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await sleep(50);
  }
  throw new Error("Chrome DevTools port did not appear.");
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("WebSocket error")));
    });
    this.ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
        return;
      }
      if (message.method) {
        const handlers = this.listeners.get(message.method);
        if (handlers) handlers.slice().forEach((handler) => handler(message.params));
      }
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  off(method, handler) {
    const handlers = this.listeners.get(method);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }

  once(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const handler = (params) => {
        cleanup();
        resolve(params);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for " + method));
      }, timeoutMs || 15000);
      const cleanup = () => {
        clearTimeout(timer);
        this.off(method, handler);
      };
      this.on(method, handler);
    });
  }

  async send(method, params) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP timeout: " + method));
        }
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch (error) {
      void error;
    }
  }
}

async function main() {
  const chromePath = findChrome();
  assert(chromePath, "Chrome or Edge executable not found.");

  const { server, port } = await startServer();
  const baseUrl = "http://127.0.0.1:" + port + "/index.html";
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "konglo-chrome-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--remote-debugging-port=0",
      "--user-data-dir=" + userDataDir,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp = null;
  const consoleErrors = [];
  const cleanup = async () => {
    if (cdp) cdp.close();
    try {
      chrome.kill();
    } catch (error) {
      void error;
    }
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (error) {
      void error;
    }
  };

  try {
    const debugPort = await waitForDevToolsPort(userDataDir, 20000);
    const targetResponse = await fetch(
      "http://127.0.0.1:" + debugPort + "/json/new?about:blank",
      { method: "PUT" },
    );
    assert(targetResponse.ok, "Could not create Chrome target.");
    const target = await targetResponse.json();
    cdp = new CDP(target.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    cdp.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      const description =
        (details.exception && details.exception.description) ||
        details.text ||
        "Uncaught exception";
      consoleErrors.push(description);
    });
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type !== "error" && params.type !== "assert") return;
      const text = (params.args || [])
        .map((arg) => arg.value || arg.description || "")
        .join(" ");
      consoleErrors.push(text || "console." + params.type);
    });
    cdp.on("Log.entryAdded", (params) => {
      const entry = params.entry || {};
      if (entry.level === "error") {
        consoleErrors.push(entry.text || "log error");
      }
    });

    const evaluate = async (expression) => {
      const response = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        const description =
          (details.exception && details.exception.description) ||
          details.text ||
          "Evaluation failed";
        throw new Error(description);
      }
      return response.result ? response.result.value : undefined;
    };

    const evalVoid = async (expression) => {
      await evaluate(expression);
    };

    const waitForApp = async (requireTestApi) => {
      const start = Date.now();
      const expression = requireTestApi
        ? "Boolean(window.KONGLOGAME && window.KONGLOGAME.__test)"
        : "Boolean(window.KONGLOGAME)";
      while (Date.now() - start < 20000) {
        try {
          if (await evaluate(expression)) return;
        } catch (error) {
          void error;
        }
        await sleep(50);
      }
      throw new Error("KONGLOGAME did not initialize.");
    };

    const reloadApp = async () => {
      const loaded = cdp.once("Page.loadEventFired", 20000);
      await cdp.send("Page.reload", { ignoreCache: true });
      await loaded.catch(() => null);
      await waitForApp(true);
      await evalVoid("window.KONGLOGAME.__test.stopLoop();");
    };

    const testScript = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__KONGLOGAME_TEST__ = true;",
    });

    const navigation = cdp.once("Page.loadEventFired", 20000);
    await cdp.send("Page.navigate", { url: baseUrl });
    await navigation.catch(() => null);
    await waitForApp(true);
    await evalVoid("window.KONGLOGAME.__test.stopLoop();");

    const getState = () => evaluate("window.KONGLOGAME.getState()");
    const getSaved = () =>
      evaluate(
        "(() => { const raw = localStorage.getItem(" +
          JSON.stringify(SAVE_KEY) +
          "); return raw ? JSON.parse(raw) : null; })()",
      );
    const resetState = async () => {
      await evalVoid(
        "window.KONGLOGAME.__test.stopLoop(); window.KONGLOGAME.__test.resetState();",
      );
    };
    const seedSave = async (save) => {
      const injection = await cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source:
            "localStorage.setItem(" +
            JSON.stringify(SAVE_KEY) +
            ", " +
            JSON.stringify(JSON.stringify(save)) +
            ");",
        },
      );
      try {
        await reloadApp();
      } finally {
        await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
          identifier: injection.identifier,
        });
      }
    };
    const readLastToast = () =>
      evaluate(
        "(() => { const items = document.querySelectorAll('#toastContainer .toast'); if (!items.length) return null; const last = items[items.length - 1]; return { text: last.textContent, className: last.className }; })()",
      );

    await test("All In dengan saldo cukup membeli saham sesuai harga terkini", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 100);",
      );
      const bought = await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)");
      assertEqual(bought, true, "buyAssetAll result");
      const state = await getState();
      assertEqual(state.money, 0, "money after all in");
      assertEqual(state.assets.stocks["0"], 10, "shares owned");
      const ui = await evaluate(
        "({ owned: document.getElementById('stock-owned-0').textContent, wallet: document.getElementById('topbarWallet').textContent })",
      );
      assertEqual(ui.owned, "10", "UI owned shares");
      assertEqual(ui.wallet, "$0.00", "UI wallet");
      const saved = await getSaved();
      assert(saved, "save exists");
      assertEqual(saved.assets.stocks["0"], 10, "saved shares");
      assertEqual(saved.money, 0, "saved money");
    });

    await test("Tombol All In tersedia di setiap kartu saham dan berfungsi", async () => {
      await resetState();
      const info = await evaluate(
        "(() => { const buttons = Array.from(document.querySelectorAll('#stocksGrid .stock-actions [data-action=\"buy-asset-all\"]')); return { count: buttons.length, expected: window.KONGLOGAME.getAssetData().stocks.length, wrongCategory: buttons.filter((button) => button.dataset.category !== 'stocks').length, missingIndex: buttons.filter((button) => !Number.isInteger(Number(button.dataset.index))).length }; })()",
      );
      assertEqual(info.count, info.expected, "All In button count");
      assertEqual(info.wrongCategory, 0, "All In buttons target stocks");
      assertEqual(info.missingIndex, 0, "All In buttons have stock index");

      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 100);",
      );
      await evalVoid("document.getElementById('stock-all-0').click();");
      const state = await getState();
      assertEqual(state.assets.stocks["0"], 10, "button click buys shares");
      assertEqual(state.money, 0, "button click updates balance");
    });

    await test("All In menolak pembelian saat saldo tidak cukup", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(50); window.KONGLOGAME.__test.setStockPrice(0, 100);",
      );
      const bought = await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)");
      assertEqual(bought, false, "buyAssetAll result");
      const state = await getState();
      assertEqual(state.money, 50, "money unchanged");
      assertEqual(state.assets.stocks["0"], undefined, "no shares owned");
      const toast = await readLastToast();
      assert(toast && /Saldo tidak cukup/.test(toast.text), "error toast shown");
      assert(toast.className.includes("toast-error"), "toast is error type");
    });

    await test("All In menolak pembelian saat saldo nol", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(0); window.KONGLOGAME.__test.setStockPrice(0, 100);",
      );
      const bought = await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)");
      assertEqual(bought, false, "buyAssetAll result");
      const state = await getState();
      assertEqual(state.money, 0, "money unchanged");
      assertEqual(state.assets.stocks["0"], undefined, "no shares owned");
    });

    await test("All In memakai harga terbaru setelah harga berubah", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 200);",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        true,
        "first all in",
      );
      let state = await getState();
      assertEqual(state.assets.stocks["0"], 5, "shares at old price");
      assertEqual(state.money, 0, "money after first all in");

      await evalVoid("window.KONGLOGAME.__test.setStockPrice(0, 250);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        false,
        "second all in rejected",
      );
      state = await getState();
      assertEqual(state.assets.stocks["0"], 5, "shares unchanged after rejection");

      await evalVoid("window.KONGLOGAME.__test.setMoney(1250);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        true,
        "third all in at new price",
      );
      state = await getState();
      assertEqual(state.assets.stocks["0"], 10, "shares after new price");
      assertEqual(state.money, 0, "money after third all in");
    });

    await test("All In menghormati batas MAX_QUANTITY", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 63);",
      );
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ assets: { stocks: { 0: " +
          (MAX_QUANTITY - 3) +
          " } } });",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        true,
        "all in near cap",
      );
      let state = await getState();
      assertEqual(state.assets.stocks["0"], MAX_QUANTITY, "reached MAX_QUANTITY");
      assertEqual(state.money, 811, "money after buying remaining capacity");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        false,
        "all in at cap rejected",
      );
      state = await getState();
      assertEqual(state.assets.stocks["0"], MAX_QUANTITY, "shares stay at cap");
      const toast = await readLastToast();
      assert(
        toast && /batas/.test(toast.text),
        "cap message shown: " + JSON.stringify(toast),
      );
    });

    await test("All In berulang mengurangi saldo dan menambah kepemilikan", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 100);",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        true,
        "first all in",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        false,
        "second all in rejected with zero balance",
      );
      let state = await getState();
      assertEqual(state.assets.stocks["0"], 10, "shares after first");
      assertEqual(state.money, 0, "money after first");

      await evalVoid("window.KONGLOGAME.__test.setMoney(500);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        true,
        "third all in after top up",
      );
      state = await getState();
      assertEqual(state.assets.stocks["0"], 15, "shares after repeated all in");
      assertEqual(state.money, 0, "money after repeated all in");
    });

    await test("All In aset bisnis mengekspansi level sesuai saldo", async () => {
      await resetState();
      const price = await evaluate(
        "window.KONGLOGAME.getAssetData().business[0].price",
      );
      await evalVoid("window.KONGLOGAME.__test.setMoney(10000);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('business', 0)"),
        true,
        "business all in",
      );
      const state = await getState();
      assertEqual(state.assets.business["0"], 9, "business level reached");
      assertEqual(state.money, 10000 - price * 45, "money after business all in");
    });

    await test("Label Bangun Bisnis/Industri berubah menjadi Ekspansi setelah pembelian pertama", async () => {
      await resetState();
      const initial = await evaluate(
        "({ business: document.getElementById('expand-business-0').textContent, industry: document.getElementById('expand-industry-0').textContent })",
      );
      assertEqual(initial.business, "Bangun Bisnis", "business label at level 0");
      assertEqual(initial.industry, "Bangun Industri", "industry label at level 0");

      await evalVoid("window.KONGLOGAME.__test.setMoney(10000000);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        true,
        "first business purchase",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('industry', 0, 1)"),
        true,
        "first industry purchase",
      );

      const after = await evaluate(
        "({ business: document.getElementById('expand-business-0').textContent, industry: document.getElementById('expand-industry-0').textContent })",
      );
      assertEqual(after.business, "Ekspansi", "business label at level 1");
      assertEqual(after.industry, "Ekspansi", "industry label at level 1");
    });

    await test("Pembelian pertama membuka Level 1 dan menampilkan biaya berikutnya", async () => {
      await resetState();
      const info = await evaluate(
        "(() => { const asset = window.KONGLOGAME.getAssetData().business[0]; return { price: asset.price, income: asset.incomePerSecond }; })()",
      );
      await evalVoid("window.KONGLOGAME.__test.setMoney(1000);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        true,
        "first business purchase",
      );
      const state = await getState();
      assertEqual(state.assets.business["0"], 1, "level after first purchase");
      assertEqual(state.money, 1000 - info.price, "money after first purchase");

      const expectedNextCost = await evaluate(
        "window.KONGLOGAME.formatUsd(" + info.price * 2 + ", { decimals: 0 })",
      );
      const expectedIncome = await evaluate(
        "window.KONGLOGAME.formatUsd(" + info.income + ", { decimals: 2 }) + '/s'",
      );
      const ui = await evaluate(
        "(() => { const button = document.getElementById('expand-business-0'); return { owned: document.getElementById('owned-business-0').textContent, price: document.getElementById('price-business-0').textContent, income: document.getElementById('income-business-0').textContent, button: button.textContent, disabled: button.disabled }; })()",
      );
      assertEqual(ui.owned, "Level 1", "owned pill");
      assertEqual(ui.price, expectedNextCost, "next expansion cost");
      assertEqual(ui.button, "Ekspansi", "button label after first purchase");
      assertEqual(ui.income, expectedIncome, "income at level 1");
      assertEqual(ui.disabled, false, "button enabled with enough money");

      const saved = await getSaved();
      assertEqual(saved.assets.business["0"], 1, "saved level");
      assertEqual(saved.version, 3, "save version");
    });

    await test("Ekspansi berikutnya menaikkan level dengan biaya progresif", async () => {
      await resetState();
      const price = await evaluate(
        "window.KONGLOGAME.getAssetData().business[0].price",
      );
      await evalVoid("window.KONGLOGAME.__test.setMoney(10000);");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        true,
        "level 1",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        true,
        "level 2",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        true,
        "level 3",
      );
      const state = await getState();
      assertEqual(state.assets.business["0"], 3, "level after expansions");
      assertEqual(state.money, 10000 - price * 6, "money after level 3");

      const expectedNextCost = await evaluate(
        "window.KONGLOGAME.formatUsd(" + price * 4 + ", { decimals: 0 })",
      );
      const ui = await evaluate(
        "({ owned: document.getElementById('owned-business-0').textContent, price: document.getElementById('price-business-0').textContent, button: document.getElementById('expand-business-0').textContent })",
      );
      assertEqual(ui.owned, "Level 3", "owned pill after expansions");
      assertEqual(ui.price, expectedNextCost, "next level cost");
      assertEqual(ui.button, "Ekspansi", "button label after expansion");
    });

    await test("Passive income bisnis dan industri mengikuti level", async () => {
      await resetState();
      const expected = await evaluate(
        "(() => { const data = window.KONGLOGAME.getAssetData(); return data.business[0].incomePerSecond * 2 + data.industry[0].incomePerSecond * 3; })()",
      );
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ assets: { business: { 0: 2 }, industry: { 0: 3 } } });",
      );
      const passive = await evaluate(
        "window.KONGLOGAME.calculatePassiveIncome().business",
      );
      assertClose(passive, expected, 0.000001, "passive income at levels");
      const state = await getState();
      assertEqual(state.assets.business["0"], 2, "business level");
      assertEqual(state.assets.industry["0"], 3, "industry level");
    });

    await test("Penambahan Oil Palm Plantation tidak mengubah ekonomi aset industri lama", async () => {
      const assets = await evaluate(
        "window.KONGLOGAME.getAssetData().industry.map((asset) => ({ name: asset.name, price: asset.price, paybackSeconds: asset.paybackSeconds, incomePerSecond: asset.incomePerSecond }))",
      );
      const oilPalm = assets.find((asset) => /Oil Palm/i.test(asset.name));
      assert(oilPalm, "Oil Palm Plantation present");
      assertEqual(oilPalm.price, 1500000, "Oil Palm price");
      assertClose(oilPalm.paybackSeconds, 480, 0.000001, "Oil Palm payback at floor");
      assertClose(
        oilPalm.incomePerSecond,
        oilPalm.price / 480,
        0.000001,
        "Oil Palm income",
      );

      const minPrice = 2000000;
      const maxPrice = 150000000;
      const priceRange = Math.log(maxPrice / minPrice);
      assets
        .filter((asset) => asset !== oilPalm)
        .forEach((asset) => {
          const position = Math.log(asset.price / minPrice) / priceRange;
          const expectedPayback =
            480 + (900 - 480) * Math.min(1, Math.max(0, position));
          assertClose(
            asset.paybackSeconds,
            expectedPayback,
            0.000001,
            asset.name + " payback unchanged",
          );
          assertClose(
            asset.incomePerSecond,
            asset.price / expectedPayback,
            0.000001,
            asset.name + " income unchanged",
          );
        });
    });

    await test("Saldo tidak cukup menonaktifkan tombol ekspansi dan menolak pembelian", async () => {
      await resetState();
      const price = await evaluate(
        "window.KONGLOGAME.getAssetData().business[0].price",
      );
      await evalVoid("window.KONGLOGAME.__test.setMoney(" + (price - 1) + ");");
      const ui = await evaluate(
        "({ disabled: document.getElementById('expand-business-0').disabled, label: document.getElementById('expand-business-0').textContent })",
      );
      assertEqual(ui.disabled, true, "button disabled without enough money");
      assertEqual(ui.label, "Bangun Bisnis", "label stays at level 0");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        false,
        "purchase rejected",
      );
      const state = await getState();
      assertEqual(state.assets.business["0"], undefined, "no level gained");
      assertEqual(state.money, price - 1, "money unchanged");
      const toast = await readLastToast();
      assert(toast && /Saldo tidak cukup/.test(toast.text), "insufficient toast");
    });

    await test("Batas level menonaktifkan ekspansi dan menolak pembelian", async () => {
      await resetState();
      const maxLevel = await evaluate(
        "window.KONGLOGAME.getConfig().assetLevels.maxLevel",
      );
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 1000000000000, assets: { business: { 0: " +
          maxLevel +
          " } } });",
      );
      let state = await getState();
      assertEqual(state.assets.business["0"], maxLevel, "level at cap");
      const ui = await evaluate(
        "({ disabled: document.getElementById('expand-business-0').disabled, label: document.getElementById('expand-business-0').textContent, price: document.getElementById('price-business-0').textContent })",
      );
      assertEqual(ui.disabled, true, "button disabled at max level");
      assertEqual(ui.label, "Ekspansi", "max level keeps expansion label");
      assertEqual(ui.price, "MAX", "max level price");
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 1)"),
        false,
        "purchase rejected at cap",
      );
      state = await getState();
      assertEqual(state.assets.business["0"], maxLevel, "level stays at cap");
      assertEqual(
        state.money,
        1000000000000,
        "money unchanged at cap",
      );

      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 1000000000000, assets: { business: { 0: " +
          (maxLevel - 1) +
          " } } });",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAsset('business', 0, 2)"),
        false,
        "purchase beyond cap rejected",
      );
      state = await getState();
      assertEqual(
        state.assets.business["0"],
        maxLevel - 1,
        "level unchanged beyond cap",
      );
    });

    await test("Save lama quantity 1 dimigrasi menjadi Level 1", async () => {
      await seedSave({
        version: 2,
        money: 1234,
        assets: {
          business: { 0: 1 },
          industry: { 0: 1 },
        },
        stockMarket: { prices: [], history: [] },
        stats: {},
      });
      const state = await getState();
      assertEqual(state.version, 3, "migrated save version");
      assertEqual(state.assets.business["0"], 1, "business level 1");
      assertEqual(state.assets.industry["0"], 1, "industry level 1");
      assertEqual(state.money, 1234, "money preserved");

      const expected = await evaluate(
        "(() => { const data = window.KONGLOGAME.getAssetData(); return data.business[0].incomePerSecond + data.industry[0].incomePerSecond; })()",
      );
      const passive = await evaluate(
        "window.KONGLOGAME.calculatePassiveIncome().business",
      );
      assertClose(passive, expected, 0.000001, "income at migrated level 1");

      const ui = await evaluate(
        "({ business: document.getElementById('owned-business-0').textContent, industry: document.getElementById('owned-industry-0').textContent })",
      );
      assertEqual(ui.business, "Level 1", "business UI level");
      assertEqual(ui.industry, "Level 1", "industry UI level");
    });

    await test("Save lama quantity lebih dari 1 dimigrasi menjadi level setara", async () => {
      await seedSave({
        version: 2,
        money: 9000,
        assets: {
          business: { 0: 5, 1: 2 },
          industry: { 0: 3 },
        },
        stockMarket: { prices: [], history: [] },
        stats: {},
      });
      const state = await getState();
      assertEqual(state.assets.business["0"], 5, "business quantity 5 -> level 5");
      assertEqual(state.assets.business["1"], 2, "business quantity 2 -> level 2");
      assertEqual(state.assets.industry["0"], 3, "industry quantity 3 -> level 3");

      const expected = await evaluate(
        "(() => { const data = window.KONGLOGAME.getAssetData(); return data.business[0].incomePerSecond * 5 + data.business[1].incomePerSecond * 2 + data.industry[0].incomePerSecond * 3; })()",
      );
      const passive = await evaluate(
        "window.KONGLOGAME.calculatePassiveIncome().business",
      );
      assertClose(passive, expected, 0.000001, "income at migrated levels");

      const twice = await evaluate(
        "(() => { const api = window.KONGLOGAME; const once = api.__test.migrateSave(api.getState()); const again = api.__test.migrateSave(once); return { business: again.assets.business, industry: again.assets.industry }; })()",
      );
      assertEqual(twice.business["0"], 5, "repeated migration keeps level 5");
      assertEqual(twice.business["1"], 2, "repeated migration keeps level 2");
      assertEqual(twice.industry["0"], 3, "repeated migration keeps level 3");
    });

    await test("Save hasil migrasi dimuat kembali tanpa kehilangan level", async () => {
      await seedSave({
        version: 2,
        money: 777,
        assets: {
          business: { 0: 4 },
          industry: { 0: 2 },
        },
        stockMarket: { prices: [], history: [] },
        stats: {},
      });
      const before = await getState();
      const beforeIncome = await evaluate(
        "window.KONGLOGAME.calculatePassiveIncome().business",
      );
      await evalVoid("window.KONGLOGAME.saveGame();");
      await reloadApp();

      const after = await getState();
      assertEqual(after.version, 3, "version after reload");
      assertEqual(after.money, before.money, "money after reload");
      assertEqual(after.assets.business["0"], 4, "business level after reload");
      assertEqual(after.assets.industry["0"], 2, "industry level after reload");
      const afterIncome = await evaluate(
        "window.KONGLOGAME.calculatePassiveIncome().business",
      );
      assertClose(afterIncome, beforeIncome, 0.000001, "income after reload");
    });

    await test("Migrasi level tidak mengubah saham dan aset fisik", async () => {
      await seedSave({
        version: 2,
        money: 5000,
        assets: {
          stocks: { 0: 7 },
          vehicles: { 0: 2 },
          motorcycle: { 1: 3 },
          realestate: { 0: 1 },
          business: { 0: 5 },
          industry: { 0: 2 },
        },
        stockMarket: { prices: [], history: [] },
        stockCostBasis: { 0: 123 },
        stats: {},
      });
      const state = await getState();
      assertEqual(state.assets.stocks["0"], 7, "stocks unchanged");
      assertEqual(state.assets.vehicles["0"], 2, "vehicles unchanged");
      assertEqual(state.assets.motorcycle["1"], 3, "motorcycle unchanged");
      assertEqual(state.assets.realestate["0"], 1, "realestate unchanged");
      assertEqual(state.assets.business["0"], 5, "business level migrated");
      assertEqual(state.assets.industry["0"], 2, "industry level migrated");
      assertEqual(state.stockCostBasis["0"], 123, "stock cost basis unchanged");

      const expectedPhysical = await evaluate(
        "(() => { const data = window.KONGLOGAME.getAssetData(); return data.vehicles[0].incomePerSecond * 2 + data.motorcycle[1].incomePerSecond * 3 + data.realestate[0].incomePerSecond; })()",
      );
      const physical = await evaluate(
        "window.KONGLOGAME.calculatePassiveIncome().physical",
      );
      assertClose(physical, expectedPhysical, 0.000001, "physical income unchanged");

      const vehiclePrice = await evaluate(
        "window.KONGLOGAME.getAssetData().vehicles[0].price",
      );
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(" +
          vehiclePrice * 2 +
          "); window.KONGLOGAME.buyAsset('vehicles', 0, 2);",
      );
      const afterBuy = await getState();
      assertEqual(
        afterBuy.assets.vehicles["0"],
        4,
        "physical assets stay quantity-based",
      );
    });

    await test("All In tidak gagal karena pembulatan floating point", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(3355446.4); window.KONGLOGAME.__test.setStockPrice(27, 3.2);",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 27)"),
        true,
        "all in near float boundary",
      );
      const state = await getState();
      assertEqual(state.assets.stocks["27"], 1048576, "shares at float boundary");
      assert(state.money >= 0, "money is not negative");
      assertClose(state.money, 3.2, 0.000001, "remaining money");
    });

    await test("Pembelian All In tetap benar setelah halaman di-refresh", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 100);",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.buyAssetAll('stocks', 0)"),
        true,
        "all in before refresh",
      );
      const savedBefore = await getSaved();
      assert(savedBefore, "save exists before refresh");
      assertEqual(savedBefore.version, 3, "save version");
      assertEqual(savedBefore.assets.stocks["0"], 10, "saved shares before refresh");

      await reloadApp();
      const state = await getState();
      assertEqual(state.money, savedBefore.money, "money after refresh");
      assertEqual(state.assets.stocks["0"], 10, "shares after refresh");
      const ui = await evaluate(
        "({ owned: document.getElementById('stock-owned-0').textContent, wallet: document.getElementById('topbarWallet').textContent })",
      );
      assertEqual(ui.owned, "10", "UI shares after refresh");
      assertEqual(ui.wallet, "$0.00", "UI wallet after refresh");
      const savedAfter = await getSaved();
      assertEqual(savedAfter.assets.stocks["0"], 10, "saved shares after refresh");
    });

    await test("Tombol All In Jual terlihat di seluruh kartu saham", async () => {
      await resetState();
      await evalVoid(
        "document.querySelector('[data-page=\"investment\"]').click();",
      );
      const info = await evaluate(
        "(() => { const cards = Array.from(document.querySelectorAll('#stocksGrid .stock-row')); const expected = window.KONGLOGAME.getAssetData().stocks.length; const buttons = cards.map((card) => card.querySelector('[data-action=\"sell-stock-all\"]')); const visible = buttons.filter((button) => { if (!button) return false; const rect = button.getBoundingClientRect(); const style = getComputedStyle(button); return rect.width >= 40 && rect.height >= 30 && style.display !== 'none' && style.visibility !== 'hidden'; }); return { expected, cards: cards.length, count: buttons.filter(Boolean).length, visible: visible.length, labels: buttons.map((button) => button ? button.textContent.trim() : null), actions: cards.map((card) => card.querySelectorAll('.stock-actions [data-action]').length), wrongTarget: buttons.filter((button) => button && !Number.isInteger(Number(button.dataset.index))).length, buttonOverflow: buttons.filter((button) => button && button.scrollWidth > button.clientWidth + 1).length, cardOverflow: cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length }; })()",
      );
      assertEqual(info.cards, info.expected, "stock card count");
      assertEqual(info.count, info.expected, "All In Jual button count");
      assertEqual(info.visible, info.expected, "All In Jual buttons visible");
      assertEqual(
        info.labels.filter((label) => label !== "All In Jual").length,
        0,
        "All In Jual labels",
      );
      assertEqual(
        info.actions.filter((count) => count !== 4).length,
        0,
        "four stock actions per card",
      );
      assertEqual(info.wrongTarget, 0, "All In Jual stock targets");
      assertEqual(info.buttonOverflow, 0, "All In Jual text overflow");
      assertEqual(info.cardOverflow, 0, "stock card overflow");

      for (const width of [390, 360]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 844,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await sleep(80);
        const mobile = await evaluate(
          "(() => { const buttons = Array.from(document.querySelectorAll('#stocksGrid [data-action=\"sell-stock-all\"]')); return { count: buttons.length, visible: buttons.filter((button) => { const rect = button.getBoundingClientRect(); const style = getComputedStyle(button); return rect.width >= 30 && rect.height >= 30 && style.display !== 'none' && style.visibility !== 'hidden'; }).length, buttonOverflow: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).length, cardOverflow: Array.from(document.querySelectorAll('#stocksGrid .stock-row')).filter((card) => card.scrollWidth > card.clientWidth + 1).length }; })()",
        );
        assertEqual(
          mobile.count,
          info.expected,
          "All In Jual count at " + width + "px",
        );
        assertEqual(
          mobile.visible,
          info.expected,
          "All In Jual visible at " + width + "px",
        );
        assertEqual(
          mobile.buttonOverflow,
          0,
          "All In Jual text overflow at " + width + "px",
        );
        assertEqual(
          mobile.cardOverflow,
          0,
          "stock card overflow at " + width + "px",
        );
      }
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    });

    await test("All In Jual disabled saat 0 saham dan aktif lagi setelah membeli", async () => {
      await resetState();
      const initial = await evaluate(
        "(() => { const buttons = Array.from(document.querySelectorAll('#stocksGrid [data-action=\"sell-stock-all\"]')); return { count: buttons.length, disabled: buttons.filter((button) => button.disabled).length }; })()",
      );
      const expected = await evaluate(
        "window.KONGLOGAME.getAssetData().stocks.length",
      );
      assertEqual(initial.count, expected, "All In Jual button count");
      assertEqual(
        initial.disabled,
        initial.count,
        "all All In Jual buttons disabled at zero shares",
      );

      let state = await getState();
      assertEqual(state.assets.stocks["0"], undefined, "no initial shares");
      await evalVoid("document.getElementById('stock-all-sell-0').click();");
      state = await getState();
      assertEqual(state.money, 500, "disabled button does not change money");
      assertEqual(state.assets.stocks["0"], undefined, "disabled button does not buy");

      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(1000); window.KONGLOGAME.__test.setStockPrice(0, 100); document.getElementById('stock-qty-0').value='5'; document.querySelector('#stock-0 [data-action=\"buy-stock\"]').click();",
      );
      state = await getState();
      assertEqual(state.assets.stocks["0"], 5, "shares after buy");
      assertEqual(state.money, 500, "money after buy");
      const active = await evaluate(
        "(() => { const button = document.getElementById('stock-all-sell-0'); return { disabled: button.disabled, othersDisabled: Array.from(document.querySelectorAll('#stocksGrid [data-action=\"sell-stock-all\"]')).filter((item) => item !== button).every((item) => item.disabled) }; })()",
      );
      assertEqual(active.disabled, false, "button active with shares");
      assertEqual(active.othersDisabled, true, "other empty stocks stay disabled");

      await evalVoid("document.getElementById('stock-all-sell-0').click();");
      state = await getState();
      assertEqual(state.assets.stocks["0"], undefined, "all shares sold");
      assertEqual(state.money, 1000, "money after all shares sold");
      assertEqual(
        await evaluate("document.getElementById('stock-all-sell-0').disabled"),
        true,
        "button disabled after selling all",
      );

      await evalVoid(
        "document.getElementById('stock-qty-0').value='2'; document.querySelector('#stock-0 [data-action=\"buy-stock\"]').click();",
      );
      state = await getState();
      assertEqual(state.assets.stocks["0"], 2, "shares after repurchase");
      assertEqual(state.money, 800, "money after repurchase");
      assertEqual(
        await evaluate("document.getElementById('stock-all-sell-0').disabled"),
        false,
        "button active after repurchase",
      );
    });

    await test("All In Jual menjual seluruh saham, saldo, cost basis, realized P/L, dan UI", async () => {
      await resetState();
      await evalVoid(
        "document.querySelector('[data-page=\"investment\"]').click(); window.KONGLOGAME.__test.setMoney(3000); window.KONGLOGAME.__test.setStockPrice(0, 100); window.KONGLOGAME.__test.setStockPrice(8, 95);",
      );
      await evalVoid(
        "window.KONGLOGAME.buyStock(0, 10); window.KONGLOGAME.buyStock(8, 4);",
      );
      let state = await getState();
      assertEqual(state.money, 1620, "money after purchases");
      assertEqual(state.assets.stocks["0"], 10, "target shares before sell");
      assertEqual(state.assets.stocks["8"], 4, "other company shares before sell");
      assertEqual(state.stockCostBasis["0"], 1000, "target cost basis before sell");
      assertEqual(state.stockCostBasis["8"], 380, "other cost basis before sell");
      assertEqual(state.stats.totalCapitalGains, 0, "initial realized P/L");

      await evalVoid(
        "window.KONGLOGAME.__test.setStockPrice(0, 120); document.getElementById('stock-all-sell-0').click();",
      );
      state = await getState();
      assertEqual(state.money, 2820, "money after All In Jual at latest price");
      assertEqual(state.assets.stocks["0"], undefined, "target fully sold");
      assertEqual(state.assets.stocks["8"], 4, "other company untouched");
      assertEqual(state.stockCostBasis["0"], undefined, "target basis removed");
      assertEqual(state.stockCostBasis["8"], 380, "other basis untouched");
      assertEqual(state.stats.totalCapitalGains, 200, "realized P/L");

      const ui = await evaluate(
        "({ owned: document.getElementById('stock-owned-0').textContent, value: document.getElementById('stock-value-0').textContent, pl: document.getElementById('stock-pl-0').textContent, stats: document.getElementById('statsCapitalGains').textContent, disabled: document.getElementById('stock-all-sell-0').disabled })",
      );
      assertEqual(ui.owned, "0", "card owned shares");
      assertEqual(ui.value, "$0.00", "card value");
      assertEqual(ui.pl, "$0.00", "card P/L");
      assert(ui.stats.includes("+$200.00"), "stats realized P/L");
      assertEqual(ui.disabled, true, "button disabled after sale");

      const saved = await getSaved();
      assert(saved, "save exists");
      assertEqual(saved.money, 2820, "saved money");
      assertEqual(saved.assets.stocks["0"], undefined, "saved target shares");
      assertEqual(saved.assets.stocks["8"], 4, "saved other shares");
      assertEqual(saved.stockCostBasis["0"], undefined, "saved target basis");
      assertEqual(saved.stats.totalCapitalGains, 200, "saved realized P/L");
    });

    await test("All In Jual menghapus seluruh cost basis tanpa drift floating point", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 0, assets: { stocks: { 0: 7 } }, stockCostBasis: { 0: 1000.3 } }); window.KONGLOGAME.__test.setStockPrice(0, 200); document.getElementById('stock-all-sell-0').click();",
      );
      const state = await getState();
      assertEqual(state.money, 1400, "proceeds at latest price");
      assertEqual(state.assets.stocks["0"], undefined, "shares fully sold");
      assertEqual(state.stockCostBasis["0"], undefined, "basis removed");
      assertEqual(
        state.stats.totalCapitalGains,
        1400 - 1000.3,
        "exact realized gain for full sale",
      );
    });

    await test("All In Jual menghormati batas saldo maksimum", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: " +
          (MAX_SAFE_MONEY - 100) +
          ", assets: { stocks: { 0: 1 } }, stockCostBasis: { 0: 100 } }); window.KONGLOGAME.__test.setStockPrice(0, 200); document.getElementById('stock-all-sell-0').click();",
      );
      let state = await getState();
      assertEqual(state.money, MAX_SAFE_MONEY - 100, "money capped at max");
      assertEqual(state.assets.stocks["0"], 1, "shares remain when wallet full");
      assertEqual(state.stockCostBasis["0"], 100, "basis remains when rejected");
      assertEqual(state.stats.totalCapitalGains, 0, "no gain when rejected");
      const toast = await readLastToast();
      assert(toast && /Saldo utama penuh/.test(toast.text), "capacity toast shown");

      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(" +
          (MAX_SAFE_MONEY - 200) +
          "); document.getElementById('stock-all-sell-0').click();",
      );
      state = await getState();
      assertEqual(state.money, MAX_SAFE_MONEY, "proceeds fit exactly at cap");
      assertEqual(state.assets.stocks["0"], undefined, "sale succeeds at boundary");
      assertEqual(state.stats.totalCapitalGains, 100, "gain at boundary");
    });

    await test("Hasil All In Jual bertahan setelah reload", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 1000, assets: { stocks: { 0: 5 } }, stockCostBasis: { 0: 500 } }); window.KONGLOGAME.__test.setStockPrice(0, 150); document.getElementById('stock-all-sell-0').click();",
      );
      const before = await getState();
      assertEqual(before.money, 1750, "money before reload");
      assertEqual(before.assets.stocks["0"], undefined, "shares before reload");
      assertEqual(before.stats.totalCapitalGains, 250, "gain before reload");

      const saved = await getSaved();
      assert(saved, "save exists before reload");
      assertEqual(saved.money, 1750, "saved money before reload");
      assertEqual(saved.assets.stocks["0"], undefined, "saved shares before reload");
      assertEqual(
        saved.stockCostBasis["0"],
        undefined,
        "saved basis before reload",
      );
      assertEqual(saved.stats.totalCapitalGains, 250, "saved gain before reload");

      await reloadApp();
      const after = await getState();
      assertEqual(after.money, 1750, "money after reload");
      assertEqual(after.assets.stocks["0"], undefined, "shares after reload");
      assertEqual(
        after.stockCostBasis["0"],
        undefined,
        "cost basis after reload",
      );
      assertEqual(after.stats.totalCapitalGains, 250, "gain after reload");
      const ui = await evaluate(
        "({ owned: document.getElementById('stock-owned-0').textContent, disabled: document.getElementById('stock-all-sell-0').disabled })",
      );
      assertEqual(ui.owned, "0", "owned UI after reload");
      assertEqual(ui.disabled, true, "All In Jual disabled after reload");
    });

    await test("Income, dividen, dan bunga tidak overflow di batas maksimum", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({" +
          "money: " +
          MAX_SAFE_MONEY +
          ", savingsAccount: " +
          MAX_SAFE_MONEY +
          ", stockDividends: " +
          MAX_SAFE_MONEY +
          ", businessIncome: " +
          MAX_SAFE_MONEY +
          ", assets: { stocks: { 0: " +
          MAX_QUANTITY +
          " }, business: { 0: " +
          MAX_QUANTITY +
          " } }" +
          "});",
      );
      await evalVoid(
        "window.KONGLOGAME.__test.gameTick(); window.KONGLOGAME.__test.payDividends(); window.KONGLOGAME.__test.creditInterest(); window.KONGLOGAME.__test.sweep();",
      );
      const state = await getState();
      const fields = [
        "money",
        "savingsAccount",
        "stockDividends",
        "businessIncome",
        "rupiahWallet",
      ];
      fields.forEach((field) => {
        assert(
          Number.isFinite(state[field]),
          field + " must stay finite, got " + state[field],
        );
        assert(state[field] >= 0, field + " must not be negative");
        assert(
          state[field] <= MAX_SAFE_MONEY,
          field + " must not exceed cap",
        );
      });
      ["totalSavingsInterest", "totalStockIncome", "totalBusinessIncome", "totalCapitalGains"].forEach(
        (field) => {
          assert(
            Number.isFinite(state.stats[field]),
            "stats." + field + " must stay finite",
          );
          assert(
            Math.abs(state.stats[field]) <= MAX_SAFE_MONEY,
            "stats." + field + " must stay capped",
          );
        },
      );
    });

    await test("Income parsial dekat batas tetap finite dan tidak negatif", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({" +
          "money: " +
          (MAX_SAFE_MONEY - 10) +
          ", savingsAccount: " +
          (MAX_SAFE_MONEY - 10) +
          ", stockDividends: " +
          (MAX_SAFE_MONEY - 10) +
          ", businessIncome: " +
          (MAX_SAFE_MONEY - 10) +
          ", assets: { stocks: { 0: " +
          MAX_QUANTITY +
          " }, business: { 0: " +
          MAX_QUANTITY +
          " } }" +
          "});",
      );
      await evalVoid(
        "window.KONGLOGAME.__test.gameTick(); window.KONGLOGAME.__test.payDividends(); window.KONGLOGAME.__test.creditInterest(); window.KONGLOGAME.__test.sweep();",
      );
      const state = await getState();
      ["money", "savingsAccount", "stockDividends", "businessIncome"].forEach(
        (field) => {
          assert(Number.isFinite(state[field]), field + " finite");
          assert(state[field] >= 0, field + " non-negative");
          assert(state[field] <= MAX_SAFE_MONEY, field + " capped");
        },
      );
    });

    await test("Honda Vario 160 dan Oil Palm Plantation tersedia dan bisa dibeli", async () => {
      await resetState();
      const info = await evaluate(
        "(() => { const data = window.KONGLOGAME.getAssetData(); const motorcycleIndex = data.motorcycle.findIndex((asset) => /Vario 160/i.test(asset.name)); const industryIndex = data.industry.findIndex((asset) => /Oil Palm/i.test(asset.name)); return { motorcycleIndex, industryIndex, motorcycle: data.motorcycle[motorcycleIndex], industry: data.industry[industryIndex] }; })()",
      );
      assert(info.motorcycleIndex >= 0, "Honda Vario 160 present");
      assert(info.industryIndex >= 0, "Oil Palm Plantation present");
      assertEqual(
        info.motorcycle.image,
        "assets/images/motorcycle/vario160.png",
        "Vario image",
      );
      assertEqual(
        info.industry.image,
        "assets/images/industry/nyawit.png",
        "Oil Palm image",
      );

      await evalVoid("window.KONGLOGAME.__test.setMoney(5000000);");
      assertEqual(
        await evaluate(
          "window.KONGLOGAME.buyAsset('motorcycle', " +
            info.motorcycleIndex +
            ", 1)",
        ),
        true,
        "buy Vario",
      );
      assertEqual(
        await evaluate(
          "window.KONGLOGAME.buyAsset('industry', " +
            info.industryIndex +
            ", 1)",
        ),
        true,
        "build Oil Palm Plantation",
      );
      const state = await getState();
      assertEqual(
        state.assets.motorcycle[String(info.motorcycleIndex)],
        1,
        "Vario owned",
      );
      assertEqual(
        state.assets.industry[String(info.industryIndex)],
        1,
        "Oil Palm level 1",
      );
    });

    await test("Gambar aset dan data aset tetap utuh", async () => {
      const info = await evaluate(
        "(() => { const data = window.KONGLOGAME.getAssetData(); const expected = Object.keys(data).filter((key) => key !== 'stocks').reduce((sum, key) => sum + data[key].length, 0); const images = Array.from(document.images); return { expected, rendered: images.length, missingSrc: images.filter((img) => !img.getAttribute('src')).length }; })()",
      );
      assertEqual(info.rendered, info.expected, "rendered asset images");
      assertEqual(info.missingSrc, 0, "images with missing src");
    });

    await test("Backup menghasilkan JSON valid dan lengkap", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 4321, assets: { business: { 0: 3 }, stocks: { 2: 5 } }, stockCostBasis: { 2: 600 }, stats: { totalBusinessIncome: 99 } });",
      );
      await evalVoid(
        "window.__backupCapture = null; window.Capacitor = { isNativePlatform: () => true, Plugins: { SaveBackup: { saveToDownloads: async ({ fileName, data }) => { window.__backupCapture = { fileName, data }; return { path: 'Download/KONGLOGAME-save/' + fileName }; } } } }; document.getElementById('backupBtn').click();",
      );
      await sleep(150);
      const captured = await evaluate("window.__backupCapture");
      await evalVoid("delete window.Capacitor; delete window.__backupCapture;");
      assert(captured, "backup captured");
      assertEqual(captured.fileName, "filesave.json", "backup file name");
      const parsed = JSON.parse(captured.data);
      assertEqual(parsed.version, 3, "backup version");
      assertEqual(parsed.money, 4321, "backup money");
      assertEqual(parsed.assets.business["0"], 3, "backup business level");
      assertEqual(parsed.assets.stocks["2"], 5, "backup shares");
      assertEqual(parsed.stockCostBasis["2"], 600, "backup cost basis");
      assertEqual(parsed.stats.totalBusinessIncome, 99, "backup stats");

      parsed.money = 1;
      parsed.assets.business["0"] = 99;
      const live = await getState();
      assertEqual(live.money, 4321, "backup object mutation does not touch live money");
      assertEqual(
        live.assets.business["0"],
        3,
        "backup object mutation does not touch live assets",
      );

      const toast = await readLastToast();
      assert(toast && toast.text.includes("Backup tersimpan"), "backup toast");
    });

    await test("Backup native tanpa plugin tidak menampilkan sukses palsu", async () => {
      await resetState();
      await evalVoid(
        "window.__backupCapture = null; window.Capacitor = { isNativePlatform: () => true, Plugins: {} }; document.getElementById('backupBtn').click();",
      );
      await sleep(150);
      const captured = await evaluate("window.__backupCapture");
      await evalVoid("delete window.Capacitor; delete window.__backupCapture;");
      assertEqual(captured, null, "no web download fallback on native");
      const toast = await readLastToast();
      assert(
        toast && toast.text.includes("plugin penyimpanan tidak tersedia"),
        "native missing plugin error toast",
      );
    });

    await test("Restore memulihkan backup valid tanpa duplikasi", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 7777, assets: { business: { 0: 4 }, vehicles: { 1: 2 } }, stats: { totalSavingsInterest: 12 } });",
      );
      const backup = await evaluate("window.KONGLOGAME.__test.createBackupJson()");
      await evalVoid("window.KONGLOGAME.__test.setState({ money: 1, assets: {} });");

      const first = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" + JSON.stringify(backup) + ")",
      );
      assertEqual(first, null, "first restore result");
      const once = await getState();
      assertEqual(once.money, 7777, "money restored");
      assertEqual(once.assets.business["0"], 4, "business restored");
      assertEqual(once.assets.vehicles["1"], 2, "vehicles restored");
      assertEqual(once.stats.totalSavingsInterest, 12, "stats restored");

      const second = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" + JSON.stringify(backup) + ")",
      );
      assertEqual(second, null, "second restore result");
      const twice = await getState();
      assertEqual(
        JSON.stringify(twice.assets),
        JSON.stringify(once.assets),
        "restore does not duplicate assets",
      );
      const saved = await getSaved();
      assert(saved, "restored save persisted");
      assertEqual(saved.money, 7777, "saved money after restore");
    });

    await test("Restore menolak JSON tidak valid tanpa mengubah progres", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(123); window.KONGLOGAME.saveGame();",
      );
      const invalid = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText('{bukan json')",
      );
      assert(typeof invalid === "string" && invalid.length > 0, "invalid json error");
      const empty = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText('   ')",
      );
      assert(typeof empty === "string" && empty.length > 0, "empty file error");
      const state = await getState();
      assertEqual(state.money, 123, "progress unchanged after invalid json");
      const saved = await getSaved();
      assertEqual(saved.money, 123, "saved progress unchanged after invalid json");
    });

    await test("Restore menolak versi dan struktur save tidak kompatibel", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setMoney(456); window.KONGLOGAME.saveGame();",
      );
      const future = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(JSON.stringify({ version: 999, money: 1, assets: {} })) +
          ")",
      );
      assert(future && future.includes("Versi"), "future version rejected");
      const badVersion = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(JSON.stringify({ version: "abc", money: 1 })) +
          ")",
      );
      assert(badVersion && badVersion.includes("Versi"), "bad version rejected");
      const emptyObject = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText('{}')",
      );
      assert(emptyObject && emptyObject.length > 0, "empty object rejected");
      const arraySave = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText('[1,2,3]')",
      );
      assert(arraySave && arraySave.length > 0, "array rejected");
      const missingMoney = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(JSON.stringify({ assets: {} })) +
          ")",
      );
      assert(missingMoney && missingMoney.length > 0, "missing money rejected");
      const incomplete = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(JSON.stringify({ money: 0, assets: {} })) +
          ")",
      );
      assert(incomplete && incomplete.includes("tidak lengkap"), "incomplete save rejected");
      const badAssets = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(
            JSON.stringify({ money: 1, assets: { stocks: [5] }, stats: {} }),
          ) +
          ")",
      );
      assert(badAssets && badAssets.includes("aset"), "array holdings rejected");
      const badStats = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(
            JSON.stringify({ money: 1, assets: {}, stats: [] }),
          ) +
          ")",
      );
      assert(badStats && badStats.includes("stats"), "array stats rejected");
      const state = await getState();
      assertEqual(state.money, 456, "progress unchanged after rejected backups");
      const saved = await getSaved();
      assertEqual(saved.money, 456, "saved progress unchanged after rejected backups");
    });

    await test("Restore menerima save lama v2 dan memigrasikan ke v3", async () => {
      await resetState();
      const legacy = {
        version: 2,
        money: 1234,
        assets: { business: { 0: 2 }, industry: { 0: 1 } },
        stockMarket: { prices: [], history: [] },
        stats: {},
      };
      const result = await evaluate(
        "window.KONGLOGAME.__test.restoreBackupText(" +
          JSON.stringify(JSON.stringify(legacy)) +
          ")",
      );
      assertEqual(result, null, "legacy restore result");
      const state = await getState();
      assertEqual(state.version, 3, "legacy save migrated to v3");
      assertEqual(state.money, 1234, "legacy money restored");
      assertEqual(state.assets.business["0"], 2, "legacy business restored");
      assertEqual(state.assets.industry["0"], 1, "legacy industry restored");
    });

    await test("Batal memilih file tidak mengubah progres", async () => {
      await resetState();
      await evalVoid("window.KONGLOGAME.__test.setMoney(55);");
      await evalVoid(
        "document.getElementById('restoreFileInput').dispatchEvent(new Event('change'));",
      );
      await sleep(50);
      const state = await getState();
      assertEqual(state.money, 55, "progress unchanged after cancel");
    });

    await test("Restore lewat file picker bertahan setelah reload", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 2468, assets: { industry: { 0: 2 } } });",
      );
      const backup = await evaluate("window.KONGLOGAME.__test.createBackupJson()");
      await evalVoid("window.KONGLOGAME.__test.setMoney(1);");
      await evalVoid(
        "(() => { const input = document.getElementById('restoreFileInput'); const dt = new DataTransfer(); dt.items.add(new File([" +
          JSON.stringify(backup) +
          "], 'filesave.json', { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change')); })()",
      );
      await sleep(150);
      const restored = await getState();
      assertEqual(restored.money, 2468, "money restored via picker");
      assertEqual(restored.assets.industry["0"], 2, "industry restored via picker");
      const toast = await readLastToast();
      assert(
        toast && toast.text.includes("berhasil dipulihkan"),
        "restore toast after picker",
      );

      await reloadApp();
      const after = await getState();
      assertEqual(after.money, 2468, "money after reload");
      assertEqual(after.assets.industry["0"], 2, "industry after reload");
    });

    await test("Tidak ada horizontal overflow pada berbagai ukuran layar", async () => {
      const sizes = [
        { width: 1440, height: 900, mobile: false },
        { width: 1024, height: 900, mobile: false },
        { width: 768, height: 900, mobile: false },
        { width: 390, height: 844, mobile: true },
        { width: 360, height: 800, mobile: true },
      ];
      const pages = ["investment", "physical", "business"];
      for (const size of sizes) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 1,
          mobile: size.mobile,
        });
        await sleep(80);
        for (const pageName of pages) {
          await evalVoid(
            "document.querySelector('[data-page=\"" +
              pageName +
              "\"]').click();",
          );
          await sleep(40);
          const overflow = await evaluate(
            "(() => { const doc = document.documentElement; return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth }; })()",
          );
          assert(
            overflow.scrollWidth <= overflow.clientWidth + 1,
            "overflow at " +
              size.width +
              "px on " +
              pageName +
              ": " +
              JSON.stringify(overflow),
          );
          assert(
            overflow.bodyScrollWidth <= overflow.clientWidth + 1,
            "body overflow at " +
              size.width +
              "px on " +
              pageName +
              ": " +
              JSON.stringify(overflow),
          );
        }
      }
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    });

    await test("Offline income tepat 10 menit dihitung penuh", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 0, assets: { business: { 0: 1 } } });",
      );
      const expected = await evaluate(
        "(() => { const api = window.KONGLOGAME; const cfg = api.getConfig(); const data = api.getAssetData(); return (cfg.mining.levels[0].rate + data.business[0].incomePerSecond) * 600; })()",
      );
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; api.__test.setOfflineLastSeen(Date.now() - 600000); return api.__test.settleOfflineIncome(); })()",
      );
      assertEqual(result.seconds, 600, "offline seconds at 10 minutes");
      assertClose(result.gross, expected, 0.001, "offline gross at 10 minutes");
      const info = await evaluate(
        "window.KONGLOGAME.__test.getOfflineIncomeInfo()",
      );
      assertClose(info.pendingGross, expected, 0.001, "pending gross at 10 minutes");
    });

    await test("Offline lebih dari 10 menit tetap dibatasi 10 menit", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 0, assets: { business: { 0: 1 } } });",
      );
      const expected = await evaluate(
        "(() => { const api = window.KONGLOGAME; const cfg = api.getConfig(); const data = api.getAssetData(); return (cfg.mining.levels[0].rate + data.business[0].incomePerSecond) * 600; })()",
      );
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; api.__test.setOfflineLastSeen(Date.now() - 3600000); return api.__test.settleOfflineIncome(); })()",
      );
      assertEqual(result.seconds, 600, "offline seconds capped");
      assertClose(result.gross, expected, 0.001, "offline gross capped");
      const info = await evaluate(
        "window.KONGLOGAME.__test.getOfflineIncomeInfo()",
      );
      assertClose(info.pendingGross, expected, 0.001, "pending gross capped");
    });

    await test("Pajak offline income 35% dan hasil bersih 65%", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 0, assets: { business: { 0: 1 } } });",
      );
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; api.__test.setOfflineLastSeen(Date.now() - 600000); return api.__test.settleOfflineIncome(); })()",
      );
      assertClose(result.net, result.gross * 0.65, 0.000001, "net is 65%");
      assertClose(result.tax, result.gross * 0.35, 0.000001, "tax is 35%");
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
        true,
        "claim succeeds",
      );
      const state = await getState();
      assertClose(state.money, result.net, 0.000001, "claimed net credited");
    });

    await test("Semua sumber income dihitung sekali di offline income", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: 0, savingsAccount: 100000, assets: { vehicles: { 0: 2 }, motorcycle: { 0: 3 }, realestate: { 0: 1 }, business: { 0: 2 }, industry: { 0: 1 }, stocks: { 0: 10 } } });",
      );
      const expected = await evaluate(
        "(() => { const api = window.KONGLOGAME; const cfg = api.getConfig(); const data = api.getAssetData(); const seconds = 600; const mining = cfg.mining.levels[0].rate * seconds; const physical = (data.vehicles[0].incomePerSecond * 2 + data.motorcycle[0].incomePerSecond * 3 + data.realestate[0].incomePerSecond) * seconds; const business = (data.business[0].incomePerSecond * 2 + data.industry[0].incomePerSecond) * seconds; const dividends = data.stocks[0].dividendPerShare * 10 * Math.floor(600000 / cfg.stocks.dividendIntervalMs); const interest = 100000 * (Math.pow(1 + cfg.savings.interestRate, Math.floor(600000 / cfg.savings.interestIntervalMs)) - 1); return { mining, physical, business, dividends, interest, gross: mining + physical + business + dividends + interest }; })()",
      );
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; api.__test.setOfflineLastSeen(Date.now() - 600000); return api.__test.settleOfflineIncome(); })()",
      );
      assertClose(result.mining, expected.mining, 0.000001, "mining income");
      assertClose(result.physical, expected.physical, 0.000001, "physical income");
      assertClose(result.business, expected.business, 0.000001, "business income");
      assertClose(
        result.stockDividends,
        expected.dividends,
        0.000001,
        "stock dividend income",
      );
      assertClose(
        result.savingsInterest,
        expected.interest,
        0.000001,
        "savings interest income",
      );
      assertClose(result.gross, expected.gross, 0.000001, "total gross income");
    });

    await test("Klaim sebelum 10 menit tetap menghabiskan satu token", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome();",
      );
      const before = await evaluate(
        "window.KONGLOGAME.__test.getResearchTokenInfo()",
      );
      assertEqual(before.available, 3, "tokens before claim");
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
        true,
        "claim before 10 minutes",
      );
      const after = await evaluate(
        "window.KONGLOGAME.__test.getResearchTokenInfo()",
      );
      assertEqual(after.available, 2, "token consumed before 10 minutes");
      assertEqual(after.uses.length, 1, "one token use recorded");
      const ui = await evaluate(
        "({ tokens: document.getElementById('offlineTokens').textContent, pending: document.getElementById('offlineAvailable').textContent, disabled: document.getElementById('claimOfflineBtn').disabled })",
      );
      assertEqual(ui.tokens, "2 / 3", "token UI after claim");
      assertEqual(ui.pending, "$0.00", "pending UI after claim");
      assertEqual(ui.disabled, true, "claim disabled after claim");
    });

    await test("Maksimal 3 token riset dalam 24 jam", async () => {
      await resetState();
      for (let index = 0; index < 3; index += 1) {
        await evalVoid(
          "window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome();",
        );
        assertEqual(
          await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
          true,
          "claim " + (index + 1),
        );
      }
      const info = await evaluate(
        "window.KONGLOGAME.__test.getResearchTokenInfo()",
      );
      assertEqual(info.available, 0, "no tokens left");
      assertEqual(info.uses.length, 3, "three token uses recorded");
      assert(info.nextTokenAt > Date.now(), "next token time in the future");

      await evalVoid(
        "window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome();",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
        false,
        "fourth claim rejected",
      );
      const after = await getState();
      assertEqual(after.offline.tokenUses.length, 3, "token uses unchanged");
      const toast = await readLastToast();
      assert(
        toast && /Token riset habis/.test(toast.text),
        "exhausted token toast",
      );
    });

    await test("Token kembali sesuai waktu reset 24 jam", async () => {
      await resetState();
      const now = Date.now();
      await evalVoid(
        "window.KONGLOGAME.__test.setOffline({ tokenUses: [" +
          (now - 1000) +
          ", " +
          (now - 1000) +
          ", " +
          (now - 1000) +
          "] });",
      );
      const info = await evaluate(
        "window.KONGLOGAME.__test.getResearchTokenInfo()",
      );
      assertEqual(info.available, 0, "tokens exhausted");
      assertEqual(
        info.nextTokenAt,
        now - 1000 + 24 * 60 * 60 * 1000,
        "next token at oldest use plus 24 hours",
      );
      const reset = await evaluate(
        "window.KONGLOGAME.__test.getResearchTokenInfo(" +
          (info.nextTokenAt + 1) +
          ")",
      );
      assertEqual(reset.available, 3, "tokens reset after 24 hours");
      assertEqual(reset.nextTokenAt, null, "no pending token after reset");

      const ui = await evaluate(
        "(() => { const sections = Array.from(document.querySelectorAll('#statsPanel .drawer-body section')); const index = sections.findIndex((section) => section.querySelector('h3') && section.querySelector('h3').textContent.trim() === 'Offline income'); const economy = sections.findIndex((section) => section.querySelector('h3') && section.querySelector('h3').textContent.trim() === 'Informasi ekonomi'); return { index, economy, hidden: document.getElementById('offlineTokenReturnRow').hidden, text: document.getElementById('offlineTokenReturn').textContent }; })()",
      );
      assertEqual(ui.economy >= 0, true, "economy section exists");
      assertEqual(ui.index, ui.economy + 1, "offline card below economy section");
      assertEqual(ui.hidden, false, "token return row visible when exhausted");
      const expectedText =
        "Token kembali pada jam " +
        new Intl.DateTimeFormat("id-ID", {
          timeZone: "Asia/Jakarta",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(new Date(info.nextTokenAt))
          .replace(":", ".") +
        " WIB";
      assertEqual(ui.text, expectedText, "token return WIB format");
    });

    await test("State token dan offline income konsisten setelah reload", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome(); window.KONGLOGAME.__test.claimOfflineIncome(); window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 30000); window.KONGLOGAME.__test.settleOfflineIncome(); window.KONGLOGAME.saveGame();",
      );
      const before = await getState();
      assertEqual(before.offline.tokenUses.length, 1, "token use before reload");
      assert(before.offline.pendingGross > 0, "pending income before reload");

      await reloadApp();
      const after = await getState();
      assertEqual(after.money, before.money, "money after reload");
      assertEqual(
        after.offline.tokenUses.length,
        1,
        "token use after reload",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.getResearchTokenInfo().available"),
        2,
        "tokens after reload",
      );
      assertClose(
        after.offline.pendingGross,
        before.offline.pendingGross,
        5,
        "pending offline income after reload",
      );
      const ui = await evaluate(
        "({ tokens: document.getElementById('offlineTokens').textContent, available: document.getElementById('offlineAvailable').textContent })",
      );
      assertEqual(ui.tokens, "2 / 3", "token UI after reload");
      assert(ui.available !== "$0.00", "pending UI after reload");
    });

    await test("Save lama tanpa data offline tetap dapat dimuat", async () => {
      await seedSave({
        version: 2,
        money: 4321,
        assets: { business: { 0: 2 }, industry: { 0: 1 } },
        stockMarket: { prices: [], history: [] },
        stats: {},
      });
      const state = await getState();
      assertEqual(state.version, 3, "legacy save migrated");
      assertEqual(state.money, 4321, "legacy money preserved");
      assert(state.offline, "offline state created");
      assert(Number.isFinite(state.offline.lastSeenAt), "last seen initialized");
      assertEqual(state.offline.tokenUses.length, 0, "no legacy token uses");
      assert(state.offline.pendingGross >= 0, "pending income defaults to zero");
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.getResearchTokenInfo().available"),
        3,
        "three tokens for legacy save",
      );
    });

    await test("Klaim berulang tidak menggandakan income", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome();",
      );
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
        true,
        "first claim",
      );
      const afterFirst = await getState();
      const second = await evaluate(
        "window.KONGLOGAME.__test.claimOfflineIncome()",
      );
      const afterSecond = await getState();
      assertEqual(second, false, "second claim rejected");
      assertEqual(afterSecond.money, afterFirst.money, "money not duplicated");
      assertEqual(
        afterSecond.offline.tokenUses.length,
        1,
        "token not consumed twice",
      );
      assertEqual(afterSecond.offline.pendingGross, 0, "pending stays cleared");
    });

    await test("Token kembali satu per satu sesuai timestamp tertua", async () => {
      await resetState();
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; const t = Date.now(); const windowMs = 24 * 60 * 60 * 1000; api.__test.setOffline({ tokenUses: [t - windowMs + 1000, t - windowMs + 3000, t - windowMs + 5000] }); const at0 = api.__test.getResearchTokenInfo(t); const at1 = api.__test.getResearchTokenInfo(t + 1001); const at2 = api.__test.getResearchTokenInfo(t + 3001); const at3 = api.__test.getResearchTokenInfo(t + 5001); return { at0, at1, at2, at3 }; })()",
      );
      assertEqual(result.at0.available, 0, "no token before oldest expires");
      assertEqual(
        result.at0.nextTokenAt,
        result.at0.uses[0] + 24 * 60 * 60 * 1000,
        "next token uses oldest timestamp",
      );
      assertEqual(result.at1.available, 1, "one token returns first");
      assertEqual(result.at1.nextTokenAt, null, "no pending return while token available");
      assertEqual(result.at2.available, 2, "second token returns");
      assertEqual(result.at3.available, 3, "third token returns");
    });

    await test("Token tidak reset oleh reload berulang", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setOffline({ tokenUses: [Date.now() - 3000, Date.now() - 2000, Date.now() - 1000] }); window.KONGLOGAME.saveGame();",
      );
      await reloadApp();
      let info = await evaluate(
        "window.KONGLOGAME.__test.getResearchTokenInfo()",
      );
      assertEqual(info.available, 0, "tokens stay exhausted after reload");
      assertEqual(info.uses.length, 3, "three uses after reload");
      await reloadApp();
      info = await evaluate("window.KONGLOGAME.__test.getResearchTokenInfo()");
      assertEqual(info.available, 0, "tokens stay exhausted after second reload");
      assertEqual(info.uses.length, 3, "three uses after second reload");
    });

    await test("Klaim gagal karena saldo penuh tidak memakai token atau pending", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setState({ money: " +
          (MAX_SAFE_MONEY - 1) +
          ", assets: { business: { 0: 1 } } }); window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome();",
      );
      const before = await getState();
      assert(before.offline.pendingGross > 0, "pending income exists");
      const claim = await evaluate(
        "window.KONGLOGAME.__test.claimOfflineIncome()",
      );
      const after = await getState();
      assertEqual(claim, false, "claim rejected at wallet capacity");
      assertEqual(after.money, before.money, "money unchanged");
      assertEqual(
        after.offline.pendingGross,
        before.offline.pendingGross,
        "pending income preserved",
      );
      assertEqual(
        after.offline.tokenUses.length,
        before.offline.tokenUses.length,
        "token preserved",
      );
      const toast = await readLastToast();
      assert(toast && /Saldo utama penuh/.test(toast.text), "capacity toast");

      await evalVoid("window.KONGLOGAME.__test.setMoney(0);");
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
        true,
        "claim succeeds after capacity freed",
      );
      const final = await getState();
      assertEqual(final.offline.pendingGross, 0, "pending cleared on success");
      assertEqual(final.offline.tokenUses.length, 1, "token used on success");
    });

    await test("Klaim gagal karena token habis tidak menghapus pending", async () => {
      await resetState();
      await evalVoid(
        "window.KONGLOGAME.__test.setOffline({ tokenUses: [Date.now() - 3000, Date.now() - 2000, Date.now() - 1000] }); window.KONGLOGAME.__test.setOfflineLastSeen(Date.now() - 60000); window.KONGLOGAME.__test.settleOfflineIncome();",
      );
      const before = await getState();
      assert(before.offline.pendingGross > 0, "pending income exists");
      assertEqual(
        await evaluate("window.KONGLOGAME.__test.claimOfflineIncome()"),
        false,
        "claim rejected without tokens",
      );
      const after = await getState();
      assertEqual(after.money, before.money, "money unchanged");
      assertEqual(
        after.offline.pendingGross,
        before.offline.pendingGross,
        "pending preserved",
      );
      assertEqual(after.offline.tokenUses.length, 3, "tokens unchanged");
    });

    await test("Settle ganda berdekatan tidak menggandakan periode dividen atau bunga", async () => {
      await resetState();
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; const t = Date.now() - 600000; api.__test.setState({ money: 0, savingsAccount: 1000000, assets: { stocks: { 0: 10 } } }); api.__test.setTimer('dividendPaidAt', t); api.__test.setTimer('savingsInterestAt', t); api.__test.setOfflineLastSeen(t); const first = api.__test.settleOfflineIncome(); const pendingAfterFirst = api.__test.getOfflineIncomeInfo().pendingGross; const second = api.__test.settleOfflineIncome(); const pendingAfterSecond = api.__test.getOfflineIncomeInfo().pendingGross; return { first, second, delta: pendingAfterSecond - pendingAfterFirst }; })()",
      );
      assert(result.first.dividendPeriods > 0, "first settle credits dividends");
      assert(result.first.interestPeriods > 0, "first settle credits interest");
      assertEqual(result.second.dividendPeriods, 0, "second settle credits no dividends");
      assertEqual(result.second.interestPeriods, 0, "second settle credits no interest");
      assert(result.delta < 1, "second settle adds no meaningful income");
    });

    await test("Settle offline tidak menyebabkan dividen dan bunga dibayar ganda saat tick", async () => {
      await resetState();
      const result = await evaluate(
        "(() => { const api = window.KONGLOGAME; const t = Date.now() - 600000; api.__test.setState({ money: 0, savingsAccount: 1000000, assets: { stocks: { 0: 10 } } }); api.__test.setTimer('dividendPaidAt', t); api.__test.setTimer('savingsInterestAt', t); api.__test.setTimer('stockUpdatedAt', Date.now()); api.__test.setTimer('sweepAt', Date.now()); api.__test.setTimer('autoSaveAt', Date.now()); api.__test.setTimer('savedAt', Date.now()); api.__test.setOfflineLastSeen(t); api.__test.settleOfflineIncome(); const before = api.getState(); api.__test.gameTick(); const after = api.getState(); return { dividendDelta: after.stockDividends - before.stockDividends, savingsDelta: after.savingsAccount - before.savingsAccount, dividendTimer: after.timers.dividendPaidAt, interestTimer: after.timers.savingsInterestAt, now: Date.now() }; })()",
      );
      assertClose(result.dividendDelta, 0, 0.000001, "no extra dividend after settle");
      assertClose(result.savingsDelta, 0, 0.000001, "no extra savings interest after settle");
      assert(result.dividendTimer <= result.now, "dividend timer not in the future");
      assert(result.interestTimer <= result.now, "interest timer not in the future");
    });

    await test("API test tidak terekspos di production", async () => {
      await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: testScript.identifier,
      });
      const loaded = cdp.once("Page.loadEventFired", 20000);
      await cdp.send("Page.reload", { ignoreCache: true });
      await loaded.catch(() => null);
      await waitForApp(false);
      const exposure = await evaluate(
        "({ test: typeof window.KONGLOGAME.__test, gameTick: typeof window.KONGLOGAME.gameTick, updateStockPrices: typeof window.KONGLOGAME.updateStockPrices, buyAssetAll: typeof window.KONGLOGAME.buyAssetAll, flag: typeof window.__KONGLOGAME_TEST__ })",
      );
      assertEqual(exposure.test, "undefined", "__test hidden");
      assertEqual(exposure.gameTick, "undefined", "gameTick hidden");
      assertEqual(
        exposure.updateStockPrices,
        "undefined",
        "updateStockPrices hidden",
      );
      assertEqual(exposure.flag, "undefined", "test flag not inherited");
      assertEqual(exposure.buyAssetAll, "function", "public buyAssetAll kept");
    });

    await test("Tidak ada error console selama pengujian", async () => {
      assertEqual(
        consoleErrors.length,
        0,
        "console errors: " + JSON.stringify(consoleErrors.slice(0, 5)),
      );
    });
  } finally {
    await cleanup();
  }

  console.log("");
  console.log(
    "TOTAL " +
      (results.passed + results.failed) +
      " | PASSED " +
      results.passed +
      " | FAILED " +
      results.failed,
  );
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FATAL " + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
