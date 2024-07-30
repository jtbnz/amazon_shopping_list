
const puppeteer = require("puppeteer");
const { exec } = require('child_process');
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

// Generate OTP
const otp = totp.generate();



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
     // "https://www.amazon.com.au/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com.au%2F%3Fref_%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=auflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
    //Italy
    "https://www.amazon.it/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.it%2Fref%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=itflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"

  );


  // Fill in login details and click the login button
  await page.waitForSelector("#ap_email");
  await page.type("#ap_email", "xxxxxe@xmail.com"); // Replace with your Amazon email
  await page.click("#continue-announce");

  await page.waitForSelector("#ap_password");
  await page.type("#ap_password", "xxxxxxxxxxxx"); // Replace with your Amazon password
  await page.click("#auth-signin-button");
  await page.waitForNavigation();


  // Capture the screenshot and save it as a PNG file
  //await page.screenshot({ path: 'pagecontent.png', fullPage: true });

  //------- This block can be commented out if you dont have a OTP set up - But you should!
  const otp = await getOTPFrom1Password();

  await page.waitForSelector("#auth-mfa-otpcode");
  await page.type("#auth-mfa-otpcode",otp); 
  await page.click("#auth-signin-button");
  await page.waitForNavigation();
  //----------------------------------------------------------------------------------------

  //await page.screenshot({ path: 'pagecontent.png', fullPage: true });


  // Navigate to the Shopping list
  await page.goto(
     //Australia/NZ
     //"https://www.amazon.com.au/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
     // Italia
     "https://www.amazon.it/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
    { timeout: 60000 }
  ); // Replace with the product URL

  // Retrieve the full HTML content of the page
  const pageContent = await page.content();
  //console.log(pageContent);

  sleep(3000, function() {
    // seems to be a delay loading the text so have a little sleep
  });


let formattedItems = [];
let i = 0;
let itemTitles = [];
let scrollT = "";
let scrollH = "";
const scrollable_section = '.virtual-list';

do {
        await scrollDown(page, i);
        itemTitles = await page.$$eval(".virtual-list .item-title", items => items.map(item => item.textContent.trim()) );
        i++;
        formattedItems.push(...itemTitles);
        scrollH = await page.$eval('.virtual-list', el => el.scrollHeight)
}
while (i*500 < scrollH)

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

function sleep(time, callback) {
  var stop = new Date().getTime();
  while (new Date().getTime() < stop + time) {
    ;
  }
  callback();
}

