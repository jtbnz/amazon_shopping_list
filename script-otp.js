
const puppeteer = require("puppeteer");
const OTPAuth = require('otpauth');
const fs = require('fs');

const secret = 'D6S3TWJ2KUNRXDDUDEP4G3BPIBPVBN6COWEGSCUGTUBR3O3F7AOA';

// Create a new OTPAuth instance
const totp = new OTPAuth.TOTP({
  issuer: 'YourIssuer',
  label: 'jmckwhite@gmail.com',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(secret)
});

// Generate OTP
const otp = totp.generate();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const element = await page.$(selector);
    if (element) {
      await element.click();
      return selector;
    }
  }
  return null;
}

async function isVisible(page, selector) {
  const element = await page.$(selector);
  if (!element) return false;
  const box = await element.boundingBox();
  return Boolean(box);
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
}

async function assertNoCaptcha(page, step) {
  if (await detectCaptcha(page)) {
    await page.screenshot({ path: `amazon-captcha-${step}.png`, fullPage: true }).catch(() => {});
    throw new Error(`Amazon CAPTCHA detected during ${step}. Manual intervention is required.`);
  }
}

async function submitEmail(page) {
  return clickFirst(page, [
    '#continue',
    'input#continue',
    'button#continue',
    'span#continue input',
    "input[type='submit']",
    "button[type='submit']",
  ]);
}

async function submitPassword(page) {
  return clickFirst(page, [
    '#signInSubmit',
    'input#signInSubmit',
    'button#signInSubmit',
    '#auth-signin-button',
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
    || await page.$('#auth-mfa-otpcode')
    || await page.$("input[name='otpCode']")
    || await page.$("input[name='code']");

  if (!looksLikeMfa) return false;

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
    await sleep(1500);
    for (const selector of otpSelectors) {
      if (await isVisible(page, selector)) {
        otpSelector = selector;
        break;
      }
    }
  }

  if (!otpSelector) {
    await page.screenshot({ path: 'amazon-mfa-field-not-found.png', fullPage: true }).catch(() => {});
    throw new Error('Amazon MFA page detected, but no OTP input field was found.');
  }

  await page.click(otpSelector, { clickCount: 3 }).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.type(otpSelector, otpCode, { delay: 20 });

  await clickFirst(page, [
    "input[name='rememberDevice']",
    '#auth-mfa-remember-device',
    "input[type='checkbox']",
  ]).catch(() => {});

  const submitted = await clickFirst(page, [
    '#auth-signin-button',
    'input#auth-signin-button',
    'button#auth-signin-button',
    "input[type='submit']",
    "button[type='submit']",
  ]);
  if (!submitted) await page.keyboard.press('Enter').catch(() => {});

  const leftMfa = await waitForEither(page, [
    async () => !page.url().toLowerCase().includes('/ap/mfa'),
    async () => await page.$('.virtual-list'),
    async () => await page.$('#ap_email'),
  ], 30000);

  if (!leftMfa) {
    throw new Error('Submitted Amazon MFA code, but the MFA page did not advance.');
  }

  if (await page.$('#ap_email')) {
    throw new Error('Amazon redirected back to login after MFA. The OTP may be invalid or another challenge is required.');
  }

  return true;
}



(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // Navigate to Amazon and login
  await page.goto(
    //Australia
     "https://www.amazon.com.au/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com.au%2F%3Fref_%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=auflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
    //Italy
    //"https://www.amazon.it/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.it%2Fref%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=itflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"

  );


  // Fill in login details and click the login button
  await page.waitForSelector("#ap_email, input[name='email'], #ap_password, input[name='password'], #auth-mfa-otpcode, input[name='otpCode'], input[name='code']", { timeout: 60000 });
  await assertNoCaptcha(page, 'signin');

  if (await isVisible(page, "#ap_email, input[name='email']")) {
    const emailSelector = "#ap_email, input[name='email']";
    await page.click(emailSelector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(emailSelector, "jmckwhite@gmail.com", { delay: 25 }); // Replace with your Amazon email

    await page.evaluate((selector) => {
      const email = document.querySelector(selector);
      if (!email) return;
      email.dispatchEvent(new Event('input', { bubbles: true }));
      email.dispatchEvent(new Event('change', { bubbles: true }));
      email.blur();
    }, emailSelector);

    await submitEmail(page);

    const movedForward = await waitForEither(page, [
      async () => await isVisible(page, "#ap_password, input[name='password']"),
      async () => await page.$('#auth-mfa-otpcode'),
      async () => await page.$("input[name='otpCode']"),
      async () => await detectCaptcha(page),
    ], 30000);

    await assertNoCaptcha(page, 'after-email');
    if (!movedForward) throw new Error('Amazon login did not advance from email to password/MFA.');
  }

  if (await isVisible(page, "#ap_password, input[name='password']")) {
    const passwordSelector = "#ap_password, input[name='password']";
    await page.click(passwordSelector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(passwordSelector, "vqr5HMH_wzk0ryz8qya", { delay: 25 }); // Replace with your Amazon password
    await submitPassword(page);
    await waitForEither(page, [
      async () => page.url().toLowerCase().includes('/ap/mfa'),
      async () => await page.$('#auth-mfa-otpcode'),
      async () => await page.$("input[name='otpCode']"),
      async () => await page.$("input[name='code']"),
      async () => await page.$('.virtual-list'),
      async () => await page.$('#ap_email'),
      async () => await detectCaptcha(page),
    ], 30000);
    await assertNoCaptcha(page, 'after-password');
  }


  // Capture the screenshot and save it as a PNG file
  //await page.screenshot({ path: 'pagecontent.png', fullPage: true });

  //------- This block can be commented out if you dont have a OTP set up - But you should!
  //const otp = await getOTPFrom1Password();

  await handleMfaIfPresent(page, otp);
  //----------------------------------------------------------------------------------------

  //await page.screenshot({ path: 'pagecontent.png', fullPage: true });


  // Navigate to the Shopping list
  await page.goto(
     //Australia/NZ
     "https://www.amazon.com.au/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
     // Italia
     //"https://www.amazon.it/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
    { timeout: 60000 }
  ); // Replace with the product URL

  await waitForEither(page, [
    async () => await page.$('.virtual-list'),
    async () => await page.$("[data-testid='alexa-shopping-list']"),
    async () => await page.$('#ap_email'),
    async () => await page.$('#auth-mfa-otpcode'),
    async () => await page.$("input[name='otpCode']"),
    async () => await detectCaptcha(page),
  ], 60000);
  await assertNoCaptcha(page, 'shopping-list');

  if (await page.$('#ap_email') || await page.$('#auth-mfa-otpcode') || await page.$("input[name='otpCode']")) {
    throw new Error('Amazon redirected back to login/MFA instead of showing the shopping list.');
  }

  await sleep(3000); // The list text can render after the container appears.


let formattedItems = [];
let i = 0;
let itemTitles = [];
let scrollT = "";
let scrollH = "";
const scrollable_section = '.virtual-list';

if (await page.$('.virtual-list')) {
        do {
                await scrollDown(page, i);
                itemTitles = await page.$$eval(".virtual-list .item-title", items => items.map(item => item.textContent.trim()) );
                i++;
                formattedItems.push(...itemTitles);
                scrollH = await page.$eval('.virtual-list', el => el.scrollHeight)
        }
        while (i*500 < scrollH)
} else {
        formattedItems = await page.evaluate(() => {
                const candidates = [
                        ...document.querySelectorAll("[data-testid='list-item'] .item-title"),
                        ...document.querySelectorAll('li .item-title'),
                        ...document.querySelectorAll('.item-title'),
                ];
                return candidates.map(item => item.textContent.trim()).filter(Boolean);
        });
}

async function scrollDown(page, i) {
        const dist = i*500;
        await page.waitForSelector('.virtual-list');
        await page.evaluate(
                (selector, dist) => {
                        const scrollableSection = document.querySelector(selector);
                        scrollableSection.scrollTop = dist;
                },
                scrollable_section, dist);
        scrollT = await page.$eval('.virtual-list', el => el.scrollTop)
};

  // Deduplicate 
  formattedItems = formattedItems.filter((item,index) => formattedItems.indexOf(item) === index);




  // Convert the array to JSON format
  let jsonFormattedItems = JSON.stringify(formattedItems, null, 2);

  
  // Save the JSON formatted list to default.htm
  const outputDir = '/home/azuser/http';
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(`${outputDir}/default.htm`, jsonFormattedItems);
	

  // Display the JSON formatted list
  console.log(jsonFormattedItems);

  // Close the browser when done
  await browser.close();
})();
