/**
 * scrapeAmazon.js - Robust Amazon Shopping List scraper
 *
 * Handles the updated Amazon login flow (email → continue → password → /ap/mfa),
 * CAPTCHA detection, and extracts items from the Alexa shopping list page.
 *
 * Configuration via environment variables (or a .env file):
 *   AMZ_LOGIN              - Amazon account email
 *   AMZ_PASS               - Amazon account password
 *   AMZ_SECRET             - TOTP secret (Base32, no spaces) for 2-step verification
 *   Amazon_Sign_in_URL     - Full Amazon sign-in URL for your region
 *   Amazon_Shopping_List_Page - Full URL to the Alexa shopping list page
 *   CHROMIUM_PATH          - (optional) Path to Chromium/Chrome binary
 *   log_level              - Set to "true" for verbose debug output + screenshots
 *
 * Output: list_of_items.json in the current working directory.
 */

require("dotenv").config();

const puppeteer = require("puppeteer-core");
const OTPAuth = require("otpauth");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(name, required = true) {
  const v = process.env[name];
  if (required && (v === undefined || v === null || `${v}`.trim() === "")) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function isTrue(v) {
  return `${v || ""}`.toLowerCase() === "true";
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function safeScreenshot(page, label, debugEnabled) {
  if (!debugEnabled) return;
  try {
    const filename = `www/${getTimestamp()}-${label}.png`;
    await page.screenshot({ path: filename, fullPage: true });
  } catch (_) {}
}

async function safeHtmlDump(page, label, debugEnabled) {
  if (!debugEnabled) return;
  try {
    const filename = `www/${getTimestamp()}-${label}.html`;
    const html = await page.content();
    fs.writeFileSync(filename, html, "utf8");
  } catch (_) {}
}

async function dumpState(page, label, debugEnabled) {
  try {
    await safeScreenshot(page, label, debugEnabled);
    await safeHtmlDump(page, label, debugEnabled);
    if (debugEnabled) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      console.log(`[DEBUG] ${label} url=${url} title=${title}`);
    }
  } catch (_) {}
}

function getBaseUrl(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

async function gotoWithRetries(
  page,
  url,
  { tries = 3, waitUntil = "domcontentloaded", timeout = 120000 } = {}
) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * i);
    }
  }
  throw lastErr;
}

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        return sel;
      }
    } catch (_) {}
  }
  return null;
}

async function isVisible(page, selector) {
  try {
    const el = await page.$(selector);
    if (!el) return false;
    const box = await el.boundingBox();
    return !!box;
  } catch (_) {
    return false;
  }
}

async function waitForEither(page, checks, timeoutMs = 30000, pollMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const c of checks) {
      try {
        if (await c()) return true;
      } catch (_) {}
    }
    await sleep(pollMs);
  }
  return false;
}

function buildTotp(secretBase32, label) {
  return new OTPAuth.TOTP({
    issuer: "Amazon",
    label: label || "Amazon OTP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

// ---------------------------------------------------------------------------
// CAPTCHA detection
// ---------------------------------------------------------------------------

async function detectCaptcha(page) {
  try {
    const url = (page.url() || "").toLowerCase();
    if (url.includes("validatecaptcha") || url.includes("/captcha")) return true;
  } catch (_) {}

  const selectors = [
    "#captchacharacters",
    "input#captchacharacters",
    "form[action*='validateCaptcha' i]",
    "img[alt*='captcha' i]",
    "input[name='cvf_captcha_input']",
    "input[name='captcha']",
  ];
  for (const sel of selectors) {
    try {
      if (await page.$(sel)) return true;
    } catch (_) {}
  }

  try {
    const text = await page.evaluate(
      () => (document.body?.innerText || "").toLowerCase()
    );
    if (text.includes("enter the characters you see below")) return true;
    if (
      text.includes(
        "sorry, we just need to make sure you're not a robot"
      )
    )
      return true;
    if (text.includes("type the characters")) return true;
  } catch (_) {}

  return false;
}

async function assertNoCaptcha(page, label, debugEnabled) {
  const isCaptcha = await detectCaptcha(page);
  if (!isCaptcha) return;
  await dumpState(page, `${label}-captcha`, debugEnabled);
  throw new Error("Amazon CAPTCHA detected. Aborting.");
}

// ---------------------------------------------------------------------------
// Login helpers
// ---------------------------------------------------------------------------

async function clickContinueOrSubmitEmail(page) {
  const clicked = await clickFirst(page, [
    "#continue",
    "span#continue input",
    "input#continue",
    "button#continue",
    "input[type='submit']",
    "button[type='submit']",
  ]);
  if (clicked) return `clicked:${clicked}`;

  const submitted = await page.evaluate(() => {
    const email = document.querySelector(
      "#ap_email, input[name='email']"
    );
    const form = email?.closest("form");
    if (form) {
      form.submit();
      return true;
    }
    return false;
  });
  if (submitted) return "submitted:form.submit()";

  try {
    await page.focus("#ap_email, input[name='email']");
    await page.keyboard.press("Enter");
    return "submitted:enter";
  } catch (_) {
    return null;
  }
}

async function submitPassword(page) {
  const clicked = await clickFirst(page, [
    "#signInSubmit",
    "input#signInSubmit",
    "button#signInSubmit",
    "button[type='submit']",
    "input[type='submit']",
    "#continue",
  ]);
  if (clicked) return `clicked:${clicked}`;

  try {
    await page.keyboard.press("Enter");
    return "submitted:enter";
  } catch (_) {
    return null;
  }
}

/**
 * Handles MFA for both /ap/mfa and the classic #auth-mfa-otpcode variants.
 */
async function handleTwoStepIfPresent(page, { secret, loginLabel, debugEnabled }) {
  const url = (page.url() || "").toLowerCase();
  const title = (await page.title().catch(() => "")).toLowerCase();

  const looksLikeMfa =
    url.includes("/ap/mfa") ||
    title.includes("two-step verification") ||
    title.includes("two step verification") ||
    (await page.$("#auth-mfa-otpcode")) ||
    (await page.$("input[name='otpCode']")) ||
    (await page.$("input[name='code']"));

  if (!looksLikeMfa) return false;

  if (!secret) {
    await dumpState(page, "mfa-missing-secret", debugEnabled);
    throw new Error("MFA required but AMZ_SECRET is missing.");
  }

  await dumpState(page, "mfa-detected", debugEnabled);
  await assertNoCaptcha(page, "mfa-detected", debugEnabled);

  const otpSelectors = [
    "#auth-mfa-otpcode",
    "input#auth-mfa-otpcode",
    "input[name='otpCode']",
    "input[name='code']",
    "input[type='tel']",
  ];

  let otpSel = null;
  for (const sel of otpSelectors) {
    try {
      if (await isVisible(page, sel)) {
        otpSel = sel;
        break;
      }
    } catch (_) {}
  }

  if (!otpSel) {
    await sleep(1500);
    for (const sel of otpSelectors) {
      try {
        if (await isVisible(page, sel)) {
          otpSel = sel;
          break;
        }
      } catch (_) {}
    }
  }

  if (!otpSel) {
    await dumpState(page, "mfa-otp-field-not-found", debugEnabled);
    throw new Error("MFA page detected but OTP input field was not found.");
  }

  // Generate a fresh TOTP token
  const totp = buildTotp(secret, loginLabel);
  const token = totp.generate();

  await page.focus(otpSel);
  await page.click(otpSel, { clickCount: 3 }).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.type(otpSel, token, { delay: 20 });

  // Best-effort "remember device" checkbox
  await clickFirst(page, [
    "input[name='rememberDevice']",
    "#auth-mfa-remember-device",
    "input[type='checkbox']",
  ]).catch(() => {});

  await dumpState(page, "mfa-otp-filled", debugEnabled);

  // Submit
  const submitSel = await clickFirst(page, [
    "#auth-signin-button",
    "input#auth-signin-button",
    "button#auth-signin-button",
    "button[type='submit']",
    "input[type='submit']",
  ]);

  if (!submitSel) {
    await page.keyboard.press("Enter").catch(() => {});
  }

  await sleep(2000);
  await dumpState(page, "mfa-after-submit", debugEnabled);
  await assertNoCaptcha(page, "mfa-after-submit", debugEnabled);

  // Confirm we left the MFA page
  const leftMfa = await waitForEither(
    page,
    [
      async () => !(page.url() || "").toLowerCase().includes("/ap/mfa"),
      async () => (await page.$(".virtual-list")) !== null,
      async () => (await page.$("#ap_email")) !== null,
    ],
    30000
  );

  if (!leftMfa) {
    await dumpState(page, "mfa-stuck", debugEnabled);
    throw new Error("Submitted MFA code but did not leave the MFA page.");
  }

  if (await page.$("#ap_email")) {
    await dumpState(page, "mfa-bounced-to-login", debugEnabled);
    throw new Error(
      "After MFA submit, Amazon redirected back to login (code wrong or challenge required)."
    );
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const AMZ_SECRET = env("AMZ_SECRET", false);
  const AMZ_LOGIN = env("AMZ_LOGIN");
  const AMZ_PASS = env("AMZ_PASS");
  const SIGNIN_URL = env("Amazon_Sign_in_URL");
  const LIST_URL = env("Amazon_Shopping_List_Page");
  const chromiumPath =
    env("CHROMIUM_PATH", false) || "/usr/bin/google-chrome";
  const debugEnabled = isTrue(env("log_level", false));

  if (debugEnabled && !fs.existsSync("www")) {
    fs.mkdirSync("www", { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromiumPath,
    userDataDir: "./tmp",
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-features=site-per-process",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(120000);

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // 1) Navigate to main domain first (helps with cookies/session)
    const base = getBaseUrl(SIGNIN_URL);
    await gotoWithRetries(page, base, {
      tries: 2,
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(800);
    await dumpState(page, "01-main", debugEnabled);

    // 2) Navigate to sign-in page
    await gotoWithRetries(page, SIGNIN_URL, {
      tries: 3,
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await dumpState(page, "02-signin", debugEnabled);
    await assertNoCaptcha(page, "02-signin", debugEnabled);

    // 3) Login flow
    await page.waitForSelector(
      "#ap_email, input[name='email'], #ap_password, input[name='password'], #auth-mfa-otpcode",
      { timeout: 60000 }
    );

    // Email step
    if (await isVisible(page, "#ap_email")) {
      const emailSel = "#ap_email";

      await page.focus(emailSel);
      await page.click(emailSel, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(emailSel, AMZ_LOGIN, { delay: 25 });

      // Trigger Amazon JS to enable Continue
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
      }, emailSel);

      await dumpState(page, "03-email-filled", debugEnabled);
      await assertNoCaptcha(page, "03-email-filled", debugEnabled);

      // Wait for Continue button to be enabled
      await page
        .waitForFunction(
          () => {
            const btn = document.querySelector("#continue");
            return !btn || !btn.hasAttribute("disabled");
          },
          { timeout: 5000 }
        )
        .catch(() => {});

      const method = await clickContinueOrSubmitEmail(page);
      if (debugEnabled) {
        console.log(`[DEBUG] email submit method: ${method || "none"}`);
      }

      const movedForward = await waitForEither(
        page,
        [
          async () =>
            await isVisible(page, "#ap_password, input[name='password']"),
          async () => (await page.$("#auth-mfa-otpcode")) !== null,
          async () => await detectCaptcha(page),
          async () => {
            const t = await page.title().catch(() => "");
            return (t || "").toLowerCase().includes("verify");
          },
        ],
        30000
      );

      await dumpState(page, "03-after-email-submit", debugEnabled);
      await assertNoCaptcha(page, "03-after-email-submit", debugEnabled);

      if (!movedForward) {
        await safeHtmlDump(page, "03-stuck-after-email", debugEnabled);
        throw new Error(
          "Stuck on email page: Continue/submit did not advance to password step."
        );
      }
    }

    // Password step
    if (await isVisible(page, "#ap_password")) {
      const pwSel = "#ap_password";

      await page.focus(pwSel);
      await page.click(pwSel, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(pwSel, AMZ_PASS, { delay: 25 });

      await dumpState(page, "05-password-filled", debugEnabled);
      await assertNoCaptcha(page, "05-password-filled", debugEnabled);

      const pwSubmitMethod = await submitPassword(page);
      if (debugEnabled) {
        console.log(
          `[DEBUG] password submit method: ${pwSubmitMethod || "none"}`
        );
      }
      await sleep(1500);
      await dumpState(page, "05-after-password-submit", debugEnabled);
      await assertNoCaptcha(page, "05-after-password-submit", debugEnabled);
    }

    // MFA step
    await handleTwoStepIfPresent(page, {
      secret: AMZ_SECRET,
      loginLabel: AMZ_LOGIN,
      debugEnabled,
    });

    await assertNoCaptcha(page, "post-mfa", debugEnabled);
    await dumpState(page, "post-mfa", debugEnabled);

    // 4) Navigate to shopping list
    await gotoWithRetries(page, LIST_URL, {
      tries: 3,
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await dumpState(page, "06-after-list-goto", debugEnabled);
    await assertNoCaptcha(page, "06-after-list-goto", debugEnabled);

    // Wait for list UI or detect redirect to login/captcha
    const ok = await waitForEither(
      page,
      [
        async () => (await page.$(".virtual-list")) !== null,
        async () =>
          (await page.$("[data-testid='alexa-shopping-list']")) !== null,
        async () => (await page.$("#ap_email")) !== null,
        async () => (await page.$("#auth-mfa-otpcode")) !== null,
        async () => (await detectCaptcha(page)) === true,
      ],
      60000
    );

    await dumpState(page, "07-list-wait-complete", debugEnabled);
    await assertNoCaptcha(page, "07-list-wait-complete", debugEnabled);

    if (!ok) throw new Error("Timed out waiting for list UI to appear.");
    if (
      (await page.$("#ap_email")) ||
      (await page.$("#auth-mfa-otpcode"))
    ) {
      throw new Error(
        "List page redirected back to login/MFA; cannot reach list UI."
      );
    }

    await sleep(1500);
    await dumpState(page, "08-list-rendered", debugEnabled);

    // 5) Extract items
    const itemTitles = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll(".virtual-list .item-title"),
        ...document.querySelectorAll(
          "[data-testid='list-item'] .item-title"
        ),
        ...document.querySelectorAll("li .item-title"),
      ];
      const titles = candidates
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);
      return Array.from(new Set(titles));
    });

    const jsonFormattedItems = JSON.stringify(itemTitles, null, 2);

    if (debugEnabled) {
      console.log(jsonFormattedItems);
    }

    // 6) Save output
    fs.writeFileSync(
      path.join(".", "list_of_items.json"),
      jsonFormattedItems,
      "utf8"
    );
    console.log(`Saved ${itemTitles.length} item(s) to list_of_items.json`);
  } catch (err) {
    await dumpState(page, "error", debugEnabled);
    console.error("Scrape failed:", err?.message || err);
    throw err;
  } finally {
    await browser.close();
  }
})();
