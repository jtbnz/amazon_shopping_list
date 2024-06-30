import requests
from bs4 import BeautifulSoup
import homeassistant.helpers.config_validation as cv
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import service
import voluptuous as vol
import logging

DOMAIN = "amazon_shopping_list"

_LOGGER = logging.getLogger(__name__)

SERVICE_FETCH_LIST = "fetch_list"

def setup(hass: HomeAssistant, config: dict):
    """Set up the Amazon Shopping List service."""

    def fetch_list(call: ServiceCall):
        """Fetch the shopping list from Amazon."""
        username = hass.secrets.get("amazon_username")
        password = hass.secrets.get("amazon_password")
        
        if not username or not password:
            _LOGGER.error("Amazon username or password not set in secrets.yaml")
            return
        
        # Amazon login URL and shopping list URL
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
                _LOGGER.error("Failed to log in to Amazon")
                return
            
            # Fetch the shopping list
            response = session.get(shopping_list_url, headers=headers)
            if response.status_code != 200:
                _LOGGER.error("Failed to fetch the shopping list from Amazon")
                return

            soup = BeautifulSoup(response.content, 'html.parser')
            items = [item.text.strip() for item in soup.select(".a-unordered-list .a-list-item")]

            # Create or update a sensor with the shopping list
            hass.states.set('sensor.amazon_shopping_list', items)
            _LOGGER.info(f"Fetched shopping list: {items}")

        except Exception as e:
            _LOGGER.error(f"Error fetching shopping list: {e}")


    hass.services.register(DOMAIN, SERVICE_FETCH_LIST, fetch_list)

    return True
