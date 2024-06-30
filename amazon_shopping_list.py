import requests
from bs4 import BeautifulSoup
from homeassistant.core import HomeAssistant, ServiceCall
import logging

_LOGGER = logging.getLogger(__name__)

DOMAIN = "amazon_shopping_list"
SERVICE_FETCH_LIST = "fetch_list"

def setup_service(hass: HomeAssistant):
    """Set up the Amazon Shopping List service."""
    _LOGGER.info("Setting up Amazon Shopping List service")

    def fetch_list(call: ServiceCall):
        """Fetch the shopping list from Amazon."""
        _LOGGER.info("Fetching shopping list from Amazon")
        
        # Read username and password from configuration
        username = hass.data[DOMAIN]["username"]
        password = hass.data[DOMAIN]["password"]

        if not username or not password:
            _LOGGER.error("Amazon username or password not set in configuration.yaml")
            return

        login_url = "https://www.amazon.com.au/ap/signin"
        shopping_list_url = "https://www.amazon.com.au/gp/alexa-shopping-list"

        session = requests.Session()
        
        # Simulate a browser header
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'}

        # Log in to Amazon
        payload = {
            'email': username,
            'password': password
        }
        try:
            login_response = session.post(login_url, data=payload, headers=headers)
            if login_response.status_code != 200:
                _LOGGER.error("Failed to log in to Amazon, status code: %s", login_response.status_code)
                return
            
            _LOGGER.info("Logged in to Amazon successfully")
            
            # Fetch the shopping list
            response = session.get(shopping_list_url, headers=headers)
            if response.status_code != 200:
                _LOGGER.error("Failed to fetch the shopping list from Amazon, status code: %s", response.status_code)
                return

            _LOGGER.info("Fetched shopping list successfully")

            soup = BeautifulSoup(response.content, 'html.parser')
            items = [item.text.strip() for item in soup.select(".a-unordered-list .a-list-item")]

            # Create or update a sensor with the shopping list
            hass.states.set('sensor.amazon_shopping_list', items)
            _LOGGER.info(f"Fetched shopping list: {items}")

        except Exception as e:
            _LOGGER.error(f"Error fetching shopping list: {e}")

    hass.services.register(DOMAIN, SERVICE_FETCH_LIST, fetch_list)
    _LOGGER.info("Amazon Shopping List service registered successfully")

def setup(hass: HomeAssistant, config: dict):
    """Set up the Amazon Shopping List component."""
    _LOGGER.info("Setting up Amazon Shopping List component")
    
    try:
        # Store the username and password in hass.data
        hass.data[DOMAIN] = {
            "username": config[DOMAIN].get("username"),
            "password": config[DOMAIN].get("password")
        }

        setup_service(hass)
        _LOGGER.info("Amazon Shopping List component setup successfully")
    except Exception as e:
        _LOGGER.error(f"Error setting up Amazon Shopping List component: {e}")
        return False
    
    return True
