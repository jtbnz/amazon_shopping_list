const fs = require('fs');
const WebSocket = require('ws');

// Home Assistant configuration
const homeAssistantUrl = 'ws://homeassistant.local:8123/api/websocket';
const homeAssistantToken = 'The long term token you create in Home assistant';
const localFilePath = '/home/azuser/http/default.htm';

// WebSocket connection
const ws = new WebSocket(homeAssistantUrl);

let pendingActions = 0;

ws.on('open', function open() {
  console.log('Connected to Home Assistant WebSocket API');
  
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    access_token: homeAssistantToken
  }));
});

ws.on('message', function message(data) {
  const message = JSON.parse(data);
  
  // Log the received message for debugging
  console.log('Received:', message);
  
  // Check if authentication was successful
  if (message.type === 'auth_ok') {
    console.log('Authentication successful');
    fetchItemsAndUpdateTodoList();
  }

  // Handle response to the service call
  if (message.type === 'result' && message.id === 1) {
    if (message.success) {
      console.log('Todo list items:', message.result.response['todo.shopping_list']);
      const todoList = message.result.response['todo.shopping_list'].items;
      const existingItems = todoList ? todoList.map(item => item.summary.toLowerCase()) : [];
      updateTodoList(existingItems);
    } else {
      console.error('Failed to get items:', message.error);
    }
  }

  if (message.type === 'result' && message.id > 1) {
    if (message.success) {
      console.log('Added/removed item successfully:', message.id);
    } else {
      console.error('Failed to add/remove item:', message.error);
    }

    // Decrease the count of pending actions
    pendingActions--;

    // If no more actions are pending, close the WebSocket connection
    if (pendingActions === 0) {
      ws.close();
    }
  }
});

ws.on('close', function close() {
  console.log('Disconnected from Home Assistant WebSocket API');
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

// Fetch items from local file and update Home Assistant todo list
const fetchItemsAndUpdateTodoList = async () => {
  try {
    const data = fs.readFileSync(localFilePath, 'utf8');
    const items = JSON.parse(data).map(item => item.toLowerCase());

    console.log('Fetched items:', items);

    // Get existing todo list items
    ws.send(JSON.stringify({
      id: 1,
      type: 'call_service',
      domain: 'todo',
      service: 'get_items',
      return_response: true,
      service_data: {
        entity_id: 'todo.shopping_list'
      }
    }));

    // Store the new items for comparison
    global.newItems = items;
  } catch (error) {
    console.error('Error reading items from local file:', error);
  }
};

// Function to update the todo list
const updateTodoList = async (existingItems) => {
  const itemsToAdd = global.newItems.filter(item => !existingItems.includes(item));
  const itemsToRemove = existingItems.filter(item => !global.newItems.includes(item));

  // Set the count of pending actions
  pendingActions = itemsToAdd.length + itemsToRemove.length;

  if (pendingActions === 0) {
    ws.close();
    return;
  }

  itemsToAdd.forEach((item, index) => {
    addTodoItem(item, index + 2); // Incrementing ID for each item
  });

  itemsToRemove.forEach((item, index) => {
    removeTodoItem(item, index + 2 + itemsToAdd.length); // Incrementing ID after add items
  });
};

// Function to add a new item to the todo list
const addTodoItem = async (item, id) => {
  ws.send(JSON.stringify({
    id: id,
    type: 'call_service',
    domain: 'todo',
    service: 'add_item',
    service_data: {
      entity_id: 'todo.shopping_list',
      item: item
    }
  }));
};

// Function to remove an item from the todo list
const removeTodoItem = async (item, id) => {
  ws.send(JSON.stringify({
    id: id,
    type: 'call_service',
    domain: 'todo',
    service: 'remove_item',
    service_data: {
      entity_id: 'todo.shopping_list',
      item: item
    }
  }));
};