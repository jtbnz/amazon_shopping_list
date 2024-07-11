
const puppeteer = require("puppeteer");
const { exec } = require('child_process');
const fs = require('fs');


// Function to retrieve OTP from 1Password using the `op` CLI
async function getOTPFrom1Password() {
    return new Promise((resolve, reject) => {
      exec('op read "op://YoursharedVaultName/ItemName/one-time password?attribute=otp"', (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          return reject(error);
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return reject(new Error(stderr));
        }
        resolve(stdout.trim()); // The OTP is in stdout
      });
    });
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
    "https://www.amazon.com.au/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com.au%2F%3Fref_%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=auflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
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


  // Navigate to the product page for which you want to scrape reviews
  await page.goto(
    "https://www.amazon.com.au/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1",
    { timeout: 60000 }
  ); // Replace with the product URL

  // Retrieve the full HTML content of the page
  const pageContent = await page.content();
  //console.log(pageContent);

  sleep(3000, function() {
    // seems to be a delay loading the text so have a little sleep
  });

  let itemTitles = await page.$$eval(".virtual-list .item-title", items =>
    items.map(item => item.textContent.trim())
  );

  // Format each item as <listItem>
  let formattedItems = itemTitles.map(item => `${item}`);

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

