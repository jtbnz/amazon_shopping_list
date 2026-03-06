If you want to run this as a Home Assistant addon see here: https://github.com/thiagobruch/HA_Addons Thanks @thiagobruch


## Overview
This container runs a Node.js script that scrapes the Alexa Shopping List page on Amazon and adds new items to a Home Assistant todo list every 5 minutes (via a webhook).

The scraper handles:
- The updated Amazon login flow (email → Continue → password — separated steps)
- Two-step verification (TOTP/MFA) via the new `/ap/mfa` endpoint
- CAPTCHA detection (aborts with an error rather than getting stuck)
- Items are added to Home Assistant via a webhook; the JSON file is removed after a successful sync

> Note: This is a one-way sync from Amazon → Home Assistant. Items are **added** but not removed from HA.

## Prerequisites

- Docker
- A Home Assistant instance with a webhook automation (see below)
- An Amazon account with 2-step verification enabled (strongly recommended)

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```
AMZ_LOGIN=your-amazon-email@example.com
AMZ_PASS=your-amazon-password
AMZ_SECRET=YOUROTPSECRETBASE32NOSPACESHERE
HA_WEBHOOK_URL=http://homeassistant.local:8123/api/webhook/your-webhook-id
Amazon_Sign_in_URL=https://www.amazon.com/ap/signin?...
Amazon_Shopping_List_Page=https://www.amazon.com/alexaquantum/sp/alexaShoppingList?ref_=list_d_wl_ys_list_1
```

See `.env.example` for full details and example URLs for US, AU, and IT regions.

### Getting your OTP secret

1. Log in to Amazon → Account → Login & Security → Two-step verification → Manage (or Turn On)
2. Under **Authenticator App**, click **Add New App**
3. Click **"Can't scan the barcode"** and copy the key (13 groups of 4 characters)
4. Remove all spaces — the result (`AMZ_SECRET`) looks like `ASDMASDFMSKDM...`
5. Verify the key works by running: `node getmyotp.js` (after updating `getmyotp.js` with your secret)

### Home Assistant webhook

Create a webhook automation in Home Assistant that accepts a POST request and adds the `name` field to your shopping list. The webhook URL goes in `HA_WEBHOOK_URL`.

### dockerfile

Change `azuser` and `azuserpassword` to values of your choice before building.

## Build
   `docker build -t amazon-scrape .`

## Run container

   `docker run -d -p 2224:22 --env-file .env --name amazon-scrape amazon-scrape`

## Testing

SSH into the container and run:

```
node scrapeAmazon.js
```

This should produce a `list_of_items.json` file with your shopping list items.


## HomeAssistant to-do list card configuration

```yaml
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
