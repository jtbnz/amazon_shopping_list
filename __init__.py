"""Amazon Shopping List integration."""
from homeassistant.core import HomeAssistant
import logging

_LOGGER = logging.getLogger(__name__)

DOMAIN = 'amazon_shopping_list'

def setup(hass: HomeAssistant, config: dict):
    """Set up the Amazon Shopping List component."""
    _LOGGER.info("Setting up Amazon Shopping List component")
    
    try:
        from .amazon_shopping_list import setup_service
        setup_service(hass)
        _LOGGER.info("Amazon Shopping List component setup successfully")
    except Exception as e:
        _LOGGER.error(f"Error setting up Amazon Shopping List component: {e}")
        return False
    
    return True
