import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// Import Mapbox as an ESM module
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
console.log("Mapbox GL JS Loaded:", mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = "pk.eyJ1IjoiYmlua3liYXJuZXMiLCJhIjoiY203aDdwYml5MDJqODJscHp1bnJwOXBxcCJ9.7EQ3EKGgkmXJBMBrwtxJ5w";

// Initialize the map
const map = new mapboxgl.Map({
  container: "map", // ID of the div where the map will render
  //   style: "mapbox://styles/mapbox/streets-v12", // Map style
  style: "mapbox://styles/binkybarnes/cm7h8tyn8002501t2ddmr87or", // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

map.on("load", async () => {
  //code
  map.addSource("boston_route", {
    type: "geojson",
    // data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
    data: "./data/Existing_Bike_Network_2022.geojson",
  });
  map.addLayer({
    id: "bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  map.addSource("cambridge_route", {
    type: "geojson",
    data: "./data/RECREATION_BikeFacilities.geojson",
  });
  map.addLayer({
    id: "bike-lanes2",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  let jsonData;
  try {
    const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

    // Await JSON fetch
    const jsonData = await d3.json(jsonurl);

    console.log("Loaded JSON Data:", jsonData); // Log to verify structure

    const svg = d3.select("#map").select("svg");

    const trips = await d3.csv("https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv", (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      let startedMinutes = minutesSinceMidnight(trip.started_at);
      //This function returns how many minutes have passed since `00:00` (midnight).
      departuresByMinute[startedMinutes].push(trip);
      //This adds the trip to the correct index in `departuresByMinute` so that later we can efficiently retrieve all trips that started at a specific time.

      // TODO: Same for arrivals
      let arrivalMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[arrivalMinutes].push(trip);
      return trip;
    });

    let stations = computeStationTraffic(jsonData.data.stations);
    console.log("Stations Array:", stations);

    const tooltip = d3.select("#tooltip"); // Ensure tooltip exists

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
    // Append circles to the SVG for each station
    const circles = svg
      .selectAll("circle")
      .data(stations, (d) => d.short_name)
      .enter()
      .append("circle")
      .attr("r", (d) => radiusScale(d.totalTraffic)) // Radius of the circle
      .attr("fill", "steelblue") // Circle fill color
      .attr("stroke", "white") // Circle border color
      .attr("stroke-width", 1) // Circle border thickness
      .attr("opacity", 0.8) // Circle opacity
      .on("mouseover", function (event, d) {
        tooltip
          .style("opacity", 0.85)
          .html(
            `<strong>${d.totalTraffic} trips</strong><br>
                ${d.departures} departures<br>
                ${d.arrivals} arrivals`
          )
          .style("left", `${event.pageX + 10}px`) // Positioning
          .style("top", `${event.pageY - 20}px`);

        d3.select(this) // Highlight the hovered circle
          .attr("stroke-width", 1.5)
          .attr("opacity", 1);
      })
      .on("mousemove", function (event) {
        tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
      })
      .on("mouseout", function () {
        tooltip.style("opacity", 0); // Hide tooltip
        d3.select(this) // Reset circle style
          .attr("stroke-width", 1)
          .attr("opacity", 0.8);
      })
      .style("--departure-ratio", (d) => stationFlow(d.departures / d.totalTraffic));

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr("cx", (d) => getCoords(d).cx) // Set the x-position using projected coordinates
        .attr("cy", (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on("move", updatePositions); // Update during map movement
    map.on("zoom", updatePositions); // Update during zooming
    map.on("resize", updatePositions); // Update on window resize
    map.on("moveend", updatePositions); // Final adjustment after movement ends

    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    function updateTimeDisplay() {
      let timeFilter = Number(timeSlider.value); // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = ""; // Clear time display
        anyTimeLabel.style.display = "block"; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = "none"; // Hide "(any time)"
      }

      // Call updateScatterPlot to reflect the changes on the map
      updateScatterPlot(timeFilter);
    }
    timeSlider.addEventListener("input", updateTimeDisplay);
    updateTimeDisplay();

    function updateScatterPlot(timeFilter) {
      // Get only the trips that match the selected time filter
      // const filteredTrips = filterTripsbyTime(trips, timeFilter);

      // Recompute station traffic based on the filtered trips
      const filteredStations = computeStationTraffic(stations, timeFilter);

      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

      // Update the scatterplot by adjusting the radius of circles
      circles
        .data(filteredStations, (d) => d.short_name)
        .join("circle") // Ensure the data is bound correctly
        .attr("r", (d) => radiusScale(d.totalTraffic))
        .style("--departure-ratio", (d) => stationFlow(d.departures / d.totalTraffic)); // Update circle sizes
    }
  } catch (error) {
    console.error("Error loading JSON:", error); // Handle errors
  }
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString("en-US", { timeStyle: "short" }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    // TODO departures
    // TODO totalTraffic
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// too slow, replaced by filter by minute
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        // Include trips that started or ended within 60 minutes of the selected time
        return Math.abs(startedMinutes - timeFilter) <= 60 || Math.abs(endedMinutes - timeFilter) <= 60;
      });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}
