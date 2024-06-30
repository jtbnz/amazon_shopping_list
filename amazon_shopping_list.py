import requests
from bs4 import BeautifulSoup
import homeassistant.helpers.config_validation as cv
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import service
import voluptuous as vol

DOMAIN = "amazon_shopping_list"

SERVICE_FETCH_LIST = "fetch_list"

def setup(hass: HomeAssistant, config: dict):
    """Set up the Amazon Shopping List service."""

    def fetch_list(call: ServiceCall):
        """Fetch the shopping list from Amazon."""
        username = hass.secrets.get("amazon_username")
        password = hass.secrets.get("amazon_password")

        # Amazon login URL and shopping list URL
        login_url = "https://www.amazon.com.au/ap/signin"
        shopping_list_url = "https://www.amazon.com.au/gp/alexa-shopping-list"

        session = requests.Session()

        # Login to Amazon
        payload = {
            'email': username,
            'password': password
        }
        session.post(login_url, data=payload)

        # Fetch the shopping list
        response = session.get(shopping_list_url)
        soup = BeautifulSoup(response.content, 'html.parser')
        items = [item.text for item in soup.select(".a-unordered-list .a-list-item")]

        # Create or update a sensor with the shopping list
        hass.states.set('sensor.amazon_shopping_list', items)

    hass.services.register(DOMAIN, SERVICE_FETCH_LIST, fetch_list)

    return True