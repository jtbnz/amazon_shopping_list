"""Amazon Shopping List integration."""
from homeassistant.core import HomeAssistant

DOMAIN = 'amazon_shopping_list'

def setup(hass: HomeAssistant, config: dict):
    """Set up the Amazon Shopping List component."""
    # Import the service from amazon_shopping_list.py
    from .amazon_shopping_list import setup_service
    setup_service(hass)
    return True
