import csv
import googlemaps
import time

# Replace with your Google Maps API key
API_KEY = "YOUR_GOOGLE_MAPS_API_KEY"
gmaps = googlemaps.Client(key=API_KEY)

# CSV file path
csv_file = "redfin20171Herndon.csv"

# Store all properties with lat/lon and scores
properties_data = []

# Define types of places we care about
place_types = ["restaurant", "gym", "supermarket", "school", "park", "cafe"]

# Function to compute average walking time to nearby places
def compute_score(lat, lon, radius=1000):
    scores = {}
    for place_type in place_types:
        try:
            # Search nearby places of this type
            places_result = gmaps.places_nearby(location=(lat, lon), radius=radius, type=place_type)
            durations = []
            for place in places_result.get("results", []):
                dest = place["geometry"]["location"]
                # Get walking time
                matrix = gmaps.distance_matrix(origins=[(lat, lon)],
                                               destinations=[(dest["lat"], dest["lng"])],
                                               mode="walking")
                duration = matrix["rows"][0]["elements"][0].get("duration", {}).get("value")
                if duration:
                    durations.append(duration)
                time.sleep(0.1)  # avoid hitting rate limits
            if durations:
                avg_duration = sum(durations) / len(durations)
            else:
                avg_duration = float("inf")  # no nearby places found
            scores[place_type] = avg_duration
        except Exception as e:
            print(f"Error fetching {place_type} for {lat},{lon}: {e}")
            scores[place_type] = float("inf")
    return scores

# Read CSV and extract lat/lon
with open(csv_file, newline='', encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        lat = float(row["LATITUDE"])
        lon = float(row["LONGITUDE"])
        scores = compute_score(lat, lon)
        properties_data.append({
            "address": row["ADDRESS"],
            "latitude": lat,
            "longitude": lon,
            "scores": scores
        })

# Optional: calculate a transportation/amenity score
for prop in properties_data:
    # Lower average duration = better score
    durations = [d for d in prop["scores"].values() if d != float("inf")]
    if durations:
        prop["transport_score"] = sum(durations) / len(durations)
    else:
        prop["transport_score"] = float("inf")

# Print results
for prop in properties_data:
    print(prop)