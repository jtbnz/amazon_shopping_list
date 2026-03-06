require('dotenv').config();
const fs = require('fs');

// Home Assistant webhook URL (set via environment variable or .env file)
const webhookUrl = process.env.HA_WEBHOOK_URL;

if (!webhookUrl) {
  console.error('HA_WEBHOOK_URL is not set. Please set it in your environment or .env file.');
  process.exit(1);
}

const filePath = 'list_of_items.json';

// Read the scraped items from the JSON file
fs.readFile(filePath, 'utf8', async (err, data) => {
  if (err) {
    console.error('Error reading the file:', err);
    return;
  }

  let items;
  try {
    items = JSON.parse(data);
  } catch (parseErr) {
    console.error('Error parsing JSON:', parseErr);
    return;
  }

  // Send each item to the Home Assistant webhook
  const addItemToShoppingList = async (item) => {
    try {
      const body = JSON.stringify({
        action: 'call_service',
        service: 'shopping_list.add_item',
        name: item,
      });
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
      });
      if (!response.ok) {
        console.error(`Failed to add item "${item}": HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(`Error adding item "${item}":`, error.message);
    }
  };

  for (const item of items) {
    await addItemToShoppingList(item);
  }

  // Delete the file after all items have been sent
  fs.unlink(filePath, (unlinkErr) => {
    if (unlinkErr) {
      console.error(`Error deleting file: ${unlinkErr.message}`);
    }
  });
});