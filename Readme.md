## Overview
This container runs a nodejs script that will scrape the shopping list page off amazon.com.au (and I assume amazon.com) and put it into a home assistant todo list

Note: your shopping list page is not visible in a desktop web browser but does appear in the mobile view. 
https://www.amazon.com.au/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1

There is some extra stuff in the container like the http server as originally I tried to do it as a web page that HA read before going back to using ws to push the list in. Which is why there is a second script to push it to HA.  I have left them as separate and the http server as it was easier for testing.

The list is retrieved and the items then compared to the list that is in HomeAssistant and items are added and deleted. 

NOTE: I intend to still use Alexa entirely for the management of the list so do not add any items into the list though home assistant

The cronjob will then run every 5 minutes, scrape the list and then push it into Home Assistant.

you can test it by running   `node script-otp.js` and it should output your shopping list

 `azuser@0f5b71c0af34:~$ node script-otp.js 

[
  "burro",
  "bucatini",
  "pecorino",
  "pollo"
]

azuser@0f5b71c0af34:~$ `


## Prerequisites



## Home Assistant Requirements

add the integration shopping list https://www.home-assistant.io/integrations/shopping_list/
## Changes you will need to do

### SSH into the container
 edit the script getmyotp.js using the secret code you get from add two step verfication 
 - for example https://www.amazon.it/a/settings/approval/appbackup?ref=ch_adsec_addExtraApp_attempt

  Change your email to your amazon account email.

  Save and run the script, this should give you a otp password to verify the setup in amazon
  `node getmyotp.js`



### dockerfile
change and azuser and azuserpassword to something that works for you.


If you are not using Amazon Australia then you will need to find your own login page:
`await page.goto(`

`"https://www.amazon.com.au/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com.au%2F%3Fref_%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=auflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"`

`);`

e.g. Italy is 

`"https://www.amazon.it/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.it%2Fref%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=itflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"`


update the script with your amazon username and password



### updateHA.js
update your homeassistant address
add in your token - Long-lived access tokens can be created using the **"Long-Lived Access Tokens"** section at the bottom of a user's Home Assistant profile page - Security tab.

## Build
   `docker build -t amazon-scrape .`

## Run container

   `docker run -d -p 2224:22  --name amazon-scrape amazon-scrape`


## Extra things I did in the container
Changed to my local timezone.
`sudo ln -fs /usr/share/zoneinfo/Pacific/Auckland /etc/localtime && sudo     dpkg-reconfigure -f noninteractive tzdata`





HomeAssistant to-do list card configuration

```
type: todo-list
entity: todo.shopping_list
card_mod:
  style:
    ha-textfield:
      $: |
        .mdc-text-field {
          margin-top: -28px;
          margin-bottom: 5px;
          height: 50px !important;
        }
        .mdc-text-field__input {
          color: white !important;
        }
      .: |
        ha-card.type-todo-list div.header {
          display: none;
        }
        ha-check-list-item.editRow.completed {
          display: none;
        }
        :host {
          --mdc-checkbox-ripple-size: 33px;
        }
        ha-check-list-item {
          min-height: 28px !important;
        }
        ha-card {
          --mdc-typography-subtitle1-font-size: 17px;
        }
        ha-icon-button.reorderButton,
        ha-icon-button.addButton {
          margin-top: -35px !important;
        }
        .divider {
          display: none;
        }
        ha-card.type-todo-list .addRow {
          display: none;
        }

```
