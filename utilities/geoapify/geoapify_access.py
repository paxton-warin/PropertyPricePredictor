import os
import requests
from dotenv import load_dotenv

# Load API key from .env
load_dotenv()
API_KEY = os.getenv("GEOAPIFY_API_KEY")

if not API_KEY:
    raise ValueError("Geoapify API key not found. Please define GEOAPIFY_API_KEY in .env")

def get_amenities(lat, lon, radius=800, categories="highway.residential, catering.restaurant.pizza", limit=10):
    """
    Get amenities around a location using Geoapify Places API.

    Args:
        lat (float): Latitude of the location
        lon (float): Longitude of the location
        radius (int): Search radius in meters
        categories (str): Pipe-separated Geoapify categories
        limit (int): Number of results to return

    Returns:
        List[dict]: List of amenities with name, category, and coordinates
    """
    url = "https://api.geoapify.com/v2/places"
    params = {
        "categories": categories,
        "filter": f"circle:{lon},{lat},{radius}",
        "limit": limit,
        "apiKey": API_KEY
    }

    response = requests.get(url, params=params)
    if response.status_code != 200:
        print("Error:", response.status_code, response.text)
        response.raise_for_status()

    data = response.json()
    amenities = []

    for feature in data.get("features", []):
        props = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        amenities.append({
            "name": props.get("name"),
            "category": props.get("categories"),
            "lat": geometry.get("coordinates", [None, None])[1],
            "lon": geometry.get("coordinates", [None, None])[0]
        })

    return amenities

def main():
    # Example coordinates (replace with your house coordinates)
    house_lat = 38.9633
    house_lon = -77.3899

    amenities = get_amenities(house_lat, house_lon, radius=1000, limit=5)
    print("Nearby amenities:")
    for a in amenities:
        print(a)

if __name__ == "__main__":
    main()