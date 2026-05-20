
const puppeteer = require("puppeteer");
const OTPAuth = require('otpauth');
const fs = require('fs');

const secret = 'YOUR_SECRET_KEY';

// Create a new OTPAuth instance
const totp = new OTPAuth.TOTP({
  issuer: 'YourIssuer',
  label: 'your@email.com',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(secret)
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// All known email field selectors (Amazon changes these across regions/redesigns)
const EMAIL_SELECTORS = '#ap_email, #ap_email_login, input[name="email"]';
// All known password field selectors
const PASSWORD_SELECTORS = '#ap_password, input[name="password"]:not(.aok-hidden)';
// All known OTP/MFA field selectors
const MFA_SELECTORS = '#auth-mfa-otpcode, input[name="otpCode"], input[name="code"]';

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        return selector;
      }
    } catch (_) {}
  }
  return null;
}

async function isVisible(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return false;
    const box = await element.boundingBox();
    return Boolean(box);
  } catch (_) {
    return false;
  }
}

async function waitForEither(page, checks, timeoutMs = 30000, pollMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const check of checks) {
      if (await check().catch(() => false)) return true;
    }
    await sleep(pollMs);
  }
  return false;
}

async function detectCaptcha(page) {
  try {
    const url = page.url().toLowerCase();
    if (url.includes('validatecaptcha') || url.includes('/captcha')) return true;

    const captchaSelectors = [
      '#captchacharacters',
      "form[action*='validateCaptcha' i]",
      "img[alt*='captcha' i]",
      "input[name='cvf_captcha_input']",
      "input[name='captcha']",
    ];

    for (const selector of captchaSelectors) {
      if (await page.$(selector)) return true;
    }

    const bodyText = await page.evaluate(() => (document.body?.innerText || '').toLowerCase()).catch(() => '');
    return bodyText.includes('enter the characters you see below')
      || bodyText.includes("sorry, we just need to make sure you're not a robot")
      || bodyText.includes('type the characters');
  } catch (_) {
    return false;
  }
}

async function assertNoCaptcha(page, step) {
  if (await detectCaptcha(page)) {
    await page.screenshot({ path: `/home/azuser/http/captcha-${step}.png`, fullPage: true }).catch(() => {});
    throw new Error(`Amazon CAPTCHA detected during ${step}. Manual intervention is required.`);
  }
}

async function submitEmail(page) {
  // Try the actual submit input inside the continue span first (Amazon AU new layout),
  // then fall back to other known continue/submit buttons
  const clicked = await clickFirst(page, [
    'span#continue input.a-button-input',
    'span#continue input',
    '#continue',
    'input#continue',
    'button#continue',
    "input[type='submit']",
    "button[type='submit']",
  ]);
  if (clicked) return `clicked:${clicked}`;

  // Fallback: submit the form directly via JS
  const submitted = await page.evaluate(() => {
    const email = document.querySelector('#ap_email, #ap_email_login, input[name="email"]');
    const form = email?.closest('form');
    if (form) { form.submit(); return true; }
    return false;
  }).catch(() => false);
  if (submitted) return 'submitted:form.submit()';

  // Last resort: press Enter
  try {
    await page.keyboard.press('Enter');
    return 'submitted:enter';
  } catch (_) {
    return null;
  }
}

async function submitPassword(page) {
  return clickFirst(page, [
    '#signInSubmit',
    'input#signInSubmit',
    'button#signInSubmit',
    '#auth-signin-button',
    'span#continue input.a-button-input',
    'span#continue input',
    '#continue',
    "input[type='submit']",
    "button[type='submit']",
  ]);
}

async function handleMfaIfPresent(page, otpCode) {
  const pageTitle = (await page.title().catch(() => '')).toLowerCase();
  const pageUrl = page.url().toLowerCase();
  const looksLikeMfa = pageUrl.includes('/ap/mfa')
    || pageTitle.includes('two-step verification')
    || pageTitle.includes('two step verification')
    || await page.$('#auth-mfa-otpcode').catch(() => null)
    || await page.$("input[name='otpCode']").catch(() => null)
    || await page.$("input[name='code']").catch(() => null);

  if (!looksLikeMfa) return false;

  console.log('[LOGIN] MFA page detected, entering OTP...');

  const otpSelectors = [
    '#auth-mfa-otpcode',
    "input[name='otpCode']",
    "input[name='code']",
    "input[type='tel']",
  ];

  let otpSelector = null;
  for (const selector of otpSelectors) {
    if (await isVisible(page, selector)) {
      otpSelector = selector;
      break;
    }
  }

  if (!otpSelector) {
    await sleep(2000);
    for (const selector of otpSelectors) {
      if (await isVisible(page, selector)) {
        otpSelector = selector;
        break;
      }
    }
  }

  if (!otpSelector) {
    await page.screenshot({ path: '/home/azuser/http/mfa-field-not-found.png', fullPage: true }).catch(() => {});
    throw new Error('Amazon MFA page detected, but no OTP input field was found.');
  }

  await page.click(otpSelector, { clickCount: 3 }).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.type(otpSelector, otpCode, { delay: 20 });

  // Try to check "remember device"
  await clickFirst(page, [
    "input[name='rememberDevice']",
    '#auth-mfa-remember-device',
  ]).catch(() => {});

  const submitted = await clickFirst(page, [
    '#auth-signin-button',
    'input#auth-signin-button',
    'button#auth-signin-button',
    'span#continue input.a-button-input',
    "input[type='submit']",
    "button[type='submit']",
  ]);
  if (!submitted) await page.keyboard.press('Enter').catch(() => {});

  const leftMfa = await waitForEither(page, [
    async () => !page.url().toLowerCase().includes('/ap/mfa'),
    async () => !page.url().toLowerCase().includes('/ap/signin'),
    async () => await page.$('.virtual-list'),
  ], 30000);

  if (!leftMfa) {
    throw new Error('Submitted Amazon MFA code, but the MFA page did not advance.');
  }

  // Check we didn't bounce back to login
  const backOnLogin = await page.$('#ap_email').catch(() => null)
    || await page.$('#ap_email_login').catch(() => null);
  if (backOnLogin) {
    throw new Error('Amazon redirected back to login after MFA. The OTP may be invalid or another challenge is required.');
  }

  console.log('[LOGIN] MFA completed successfully.');
  return true;
}


(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    executablePath: '/usr/bin/google-chrome',
    userDataDir: '/home/azuser/chrome-data',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(120000);

  // Set a realistic user agent to avoid bot detection
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  try {
    // Navigate to Amazon sign-in
    console.log('[LOGIN] Navigating to Amazon sign-in page...');
    await page.goto(
      //Australia
       "https://www.amazon.com.au/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com.au%2F%3Fref_%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=auflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
      //Italy
      //"https://www.amazon.it/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.it%2Fref%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=itflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    await sleep(1000);
    await assertNoCaptcha(page, 'signin');

    // Wait for any login-related field to appear
    await page.waitForSelector(
      `${EMAIL_SELECTORS}, ${PASSWORD_SELECTORS}, ${MFA_SELECTORS}`,
      { timeout: 60000 }
    );

    console.log('[LOGIN] Sign-in page loaded. URL:', page.url());

    // ---- EMAIL STEP ----
    if (await isVisible(page, EMAIL_SELECTORS)) {
      console.log('[LOGIN] Entering email...');
      // Find which specific email selector is present and visible
      const emailSel = await page.evaluate((selectors) => {
        for (const sel of selectors.split(',').map(s => s.trim())) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return sel;
        }
        // Fallback: return first one that exists
        for (const sel of selectors.split(',').map(s => s.trim())) {
          if (document.querySelector(sel)) return sel;
        }
        return null;
      }, EMAIL_SELECTORS);

      if (emailSel) {
        await page.click(emailSel, { clickCount: 3 }).catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.type(emailSel, "your@email.com", { delay: 25 }); // Replace with your Amazon email

        // Dispatch events to trigger Amazon's JS validation
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
        }, emailSel);

        await sleep(500);

        // Wait for continue button to be enabled
        await page.waitForFunction(() => {
          const btn = document.querySelector('#continue, span#continue input');
          return !btn || !btn.hasAttribute('disabled');
        }, { timeout: 5000 }).catch(() => {});

        const emailSubmitMethod = await submitEmail(page);
        console.log('[LOGIN] Email submitted via:', emailSubmitMethod || 'unknown');

        // Wait for the page to navigate or for password/MFA fields to appear
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(2000); // Let the new page render

        console.log('[LOGIN] After email navigation. URL:', page.url());

        // Wait for password field or MFA to become visible
        const movedForward = await waitForEither(page, [
          async () => await isVisible(page, PASSWORD_SELECTORS),
          async () => await isVisible(page, MFA_SELECTORS),
          async () => page.url().toLowerCase().includes('/ap/mfa'),
          async () => await detectCaptcha(page),
        ], 30000);

        await assertNoCaptcha(page, 'after-email');

        if (!movedForward) {
          // Dump state for debugging
          await page.screenshot({ path: '/home/azuser/http/stuck-after-email.png', fullPage: true }).catch(() => {});
          const html = await page.content().catch(() => '');
          fs.writeFileSync('/home/azuser/http/stuck-after-email.html', html);
          console.log('[LOGIN] Stuck after email. URL:', page.url());
          console.log('[LOGIN] Title:', await page.title().catch(() => ''));
          throw new Error('Amazon login did not advance from email to password/MFA.');
        }
      }
    }

    // ---- PASSWORD STEP ----
    if (await isVisible(page, PASSWORD_SELECTORS)) {
      console.log('[LOGIN] Entering password...');
      const pwSel = await page.evaluate((selectors) => {
        for (const sel of selectors.split(',').map(s => s.trim())) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return sel;
        }
        return null;
      }, PASSWORD_SELECTORS);

      if (pwSel) {
        await page.click(pwSel, { clickCount: 3 }).catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.type(pwSel, "your_password", { delay: 25 }); // Replace with your Amazon password

        // Submit password and wait for navigation to complete
        const pwSubmitMethod = await submitPassword(page);
        console.log('[LOGIN] Password submitted via:', pwSubmitMethod || 'unknown');

        // Wait for the page to navigate away or for MFA/content to appear
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(2000); // Let the new page render

        console.log('[LOGIN] After password navigation. URL:', page.url());
        console.log('[LOGIN] After password navigation. Title:', await page.title().catch(() => ''));

        await assertNoCaptcha(page, 'after-password');
      }
    }

    // ---- MFA STEP ----
    // Generate OTP fresh right before use
    const otp = totp.generate();

    // Dump state before MFA check so we can see what's actually on the page
    console.log('[LOGIN] Pre-MFA URL:', page.url());
    console.log('[LOGIN] Pre-MFA title:', await page.title().catch(() => ''));
    await page.screenshot({ path: '/home/azuser/http/pre-mfa.png', fullPage: true }).catch(() => {});
    const preMfaHtml = await page.content().catch(() => '');
    fs.writeFileSync('/home/azuser/http/pre-mfa.html', preMfaHtml);

    // Wait a bit for MFA page to load - Amazon can be slow here
    await sleep(3000);

    // Check again after sleep
    console.log('[LOGIN] Post-wait URL:', page.url());
    console.log('[LOGIN] Post-wait title:', await page.title().catch(() => ''));

    // Try to find ANY OTP/verification input on the page even if URL doesn't say /ap/mfa
    const hasMfaField = await waitForEither(page, [
      async () => await isVisible(page, '#auth-mfa-otpcode'),
      async () => await isVisible(page, "input[name='otpCode']"),
      async () => await isVisible(page, "input[name='code']"),
      async () => await isVisible(page, "input[type='tel']"),
      async () => page.url().toLowerCase().includes('/ap/mfa'),
    ], 10000);

    if (hasMfaField) {
      console.log('[LOGIN] MFA detected, handling...');
      await handleMfaIfPresent(page, otp);
    } else {
      console.log('[LOGIN] No MFA detected. Checking if already logged in...');
      // Maybe session cookies from userDataDir mean we're already authenticated
    }

    console.log('[LOGIN] Login complete. URL:', page.url());

    // ---- NAVIGATE TO SHOPPING LIST ----
    console.log('[SCRAPE] Navigating to shopping list...');
    await page.goto(
       //Australia/NZ
       "https://www.amazon.com.au/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
       // Italia
       //"https://www.amazon.it/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
      { timeout: 60000, waitUntil: 'domcontentloaded' }
    );

    // Wait for the page to settle after any redirects
    await sleep(3000);

    console.log('[SCRAPE] Shopping list page URL:', page.url());
    console.log('[SCRAPE] Shopping list page title:', await page.title().catch(() => ''));

    // Check if we got bounced back to login
    const onLoginPage = page.url().toLowerCase().includes('/ap/signin');
    if (onLoginPage) {
      await page.screenshot({ path: '/home/azuser/http/bounced-to-login.png', fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => '');
      fs.writeFileSync('/home/azuser/http/bounced-to-login.html', html);
      throw new Error('Amazon redirected back to login instead of showing the shopping list. Login session may not have persisted.');
    }

    await assertNoCaptcha(page, 'shopping-list');

    // Wait for list content to render
    await waitForEither(page, [
      async () => await page.$('.virtual-list'),
      async () => await page.$("[data-testid='alexa-shopping-list']"),
      async () => await page.$('.item-title'),
    ], 30000);

    await sleep(3000); // Extra time for list items to render

    // ---- EXTRACT ITEMS ----
    let formattedItems = [];

    if (await page.$('.virtual-list')) {
      console.log('[SCRAPE] Found .virtual-list, scrolling to collect items...');
      let i = 0;
      let scrollH = 0;
      const scrollable_section = '.virtual-list';

      do {
        const dist = i * 500;
        await page.evaluate((selector, dist) => {
          const el = document.querySelector(selector);
          if (el) el.scrollTop = dist;
        }, scrollable_section, dist);

        await sleep(300);

        const titles = await page.$$eval(".virtual-list .item-title",
          items => items.map(item => item.textContent.trim())
        ).catch(() => []);

        formattedItems.push(...titles);
        scrollH = await page.$eval('.virtual-list', el => el.scrollHeight).catch(() => 0);
        i++;
      } while (i * 500 < scrollH);
    } else {
      console.log('[SCRAPE] No .virtual-list found, trying fallback selectors...');
      formattedItems = await page.evaluate(() => {
        const candidates = [
          ...document.querySelectorAll("[data-testid='list-item'] .item-title"),
          ...document.querySelectorAll('li .item-title'),
          ...document.querySelectorAll('.item-title'),
        ];
        return candidates.map(item => item.textContent.trim()).filter(Boolean);
      }).catch(() => []);
    }

    // Deduplicate
    formattedItems = [...new Set(formattedItems)];

    // If still empty, dump page for debugging
    if (formattedItems.length === 0) {
      console.log('[SCRAPE] No items found. Dumping page state for debugging...');
      await page.screenshot({ path: '/home/azuser/http/debug-list.png', fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => '');
      fs.writeFileSync('/home/azuser/http/debug-list.html', html);
    }

    const jsonFormattedItems = JSON.stringify(formattedItems, null, 2);

    // Save to file
    const outputDir = '/home/azuser/http';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(`${outputDir}/default.htm`, jsonFormattedItems);

    // Display
    console.log(jsonFormattedItems);

    await browser.close();
  } catch (err) {
    console.error('[ERROR]', err?.message || err);
    await page.screenshot({ path: '/home/azuser/http/error.png', fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    fs.writeFileSync('/home/azuser/http/error.html', html);
    await browser.close();
    process.exit(1);
  }
})();
