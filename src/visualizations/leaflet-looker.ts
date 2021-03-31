// eslint-disable
import "leaflet";
import "../leaflet/leaflet.scss";
import isEqual from "lodash.isequal";
import { Looker, VisualizationDefinition } from "../common/types";

const L = window["L"];

// Global values provided via the API
declare var looker: Looker;

// These are used to determine when the mouse moves off of a circle
let currentPoint;
let currentRadius;

// These are used to track the current zoom and positioning of the map
let oldZoom;
let oldLat;
let oldLng;

// This is to check if the initial configs come through,
// which happens on the 4th update or so, it depends.  It's tricky.
let isInitialized = false;

interface LeafletMap extends VisualizationDefinition {}

// initializing and drawing first map, before we have any data.
// this initial location bounds the US.
let dataBounds = [[49, -126], [24, -65]];

// Initialize the map.
let map = new L.Map("vis")
  .fitBounds(dataBounds)
  .on("mousemove", onMouseMoveAction);

// Having layer variables declared in this scope makes it easier to unmount.
let pointsLayer;
let linesLayer;

const vis: LeafletMap = {
  id: "leaflet",
  label: "leaflet",
  options: {
    colorRange: {
      type: "array",
      section: "Style",
      label: "Color Range",
      display: "colors",
      default: [
        "#dd3333",
        "#80ce5d",
        "#f78131",
        "#369dc1",
        "#c572d3",
        "#36c1b3",
        "#b57052",
        "#ed69af"
      ]
    },
    lineColor: {
      type: "string",
      section: "Style",
      default: "#FF0000",
      label: "Line Color",
      display: "color"
    },
    showPopup: {
      type: "boolean",
      section: "Style",
      default: "false",
      label: "Show Popup"
    },
    lineNumber: {
      min: 1,
      max: 20,
      step: 1,
      default: 5,
      type: "number",
      section: "Style",
      label: "Number of Lines"
    },
    maxPointSize: {
      min: 1,
      max: 20,
      step: 1,
      default: 9,
      type: "number",
      section: "Style",
      label: "Maximum Point Size"
    },
    minPointSize: {
      min: 1,
      max: 10,
      step: 1,
      default: 3,
      type: "number",
      section: "Style",
      label: "Minimum Point Size"
    },
    zoom: {
      min: 1,
      max: 20,
      step: 1,
      default: 4,
      type: "number",
      section: "Windowing",
      label: "Zoom Level",
      display: "range"
    },
    lat: {
      min: -90,
      max: 90,
      step: 0.000001,
      default: 0,
      type: "number",
      section: "Windowing",
      label: "Latitude",
      display: "range"
    },
    lng: {
      min: -180,
      max: 180,
      step: 0.000001,
      default: 0,
      type: "number",
      section: "Windowing",
      label: "Longitude",
      display: "range"
    }
  },
  // Set up the initial state of the visualization
  create: function(element, config) {
    // set default props:
    if (config.colorRange == null || !/^#/.test(config.colorRange[0])) {
      // Workaround for Looker bug where we don't get custom colors.
      config.colorRange = this.options.colorRange.default;
    }
    if (typeof config.lineColor != "string") {
      config.lineColor = this.options.lineColor.default;
    }
    if (typeof config.lineNumber != "number") {
      config.lineNumber = this.options.lineNumber.default;
    }
    if (typeof config.maxPointSize != "number") {
      config.maxPointSize = this.options.maxPointSize.default;
    }
    if (typeof config.minPointSize != "number") {
      config.minPointSize = this.options.minPointSize.default;
    }
    // create the tile layer with correct attribution
    var osmUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    var osmAttrib =
      'Map data © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors';
    var osm = new L.TileLayer(osmUrl, {
      minZoom: 2,
      maxZoom: 20,
      attribution: osmAttrib
    });
    map.addLayer(osm);

    // bind action tracking for zoom and movement
    map.on("zoomend", () => onZoomEndAction(this));
    map.on("moveend", () => onMoveEndAction(this));
  },

  // Render in response to the data
  update: function(data, element, config, queryResponse) {
    // const [bounds, minLat, minLong, maxLat, maxLong] = getDataBounds(data);

    let dimensionQueryParts = queryResponse.fields.dimensions.map(x => {
      return {
        type: x.type,
        label_short: x.label_short,
        name: x.name,
        isFirstMeasure: false,
        isSecondMeasure: false
      };
    });


    let measureQueryParts = queryResponse.fields.measures.map((x, i) => {
      return {
        type: x.type,
        label_short: x.label_short,
        name: x.name,
        isFirstMeasure: i === 0,
        isSecondMeasure: i === 1
      };
    });

    let allQueryParts = [...dimensionQueryParts, ...measureQueryParts];

    if (!isInitialized && config.zoom) {
      map.flyTo(L.latLng(config.lat, config.lng), config.zoom, {
        animate: false
      });
      isInitialized = true;
    }

    // if this is the first render, update the zoom with the stored parameters
    // if (!oldLat && !oldLng && config.lat === 0 && config.lng === 0) {
    // } else if (config.lat === 0 && config.lng === 0) {
    //   setDataBounds(getDataBounds(data)[0]);
    // }

    if (config.lat !== oldLat) oldLat = config.lat;
    if (config.lng !== oldLng) oldLng = config.lng;
    if (config.zoom !== oldZoom) oldZoom = config.zoom;

    addPoints(simplePointData(data), map, data, config, allQueryParts);
  }
};

// Helper function to convert to simple points if necessary
const simplePointData = data =>
  data.map(x => {
    for (var name in x) {
      if (x.hasOwnProperty(name)) {
        if (x[name] && x[name].value) return x[name].value;
      }
    }
  });

const findFilterableValue = x => {
  for (var name in x) {
    if (x.hasOwnProperty(name)) {
      if (x[name] && x[name].filterable_value) return x[name].filterable_value;
    }
  }
};

const findSourceDataPoint = (latlng, fullData) => {
  const filterString = `${latlng.lat},${latlng.lng}`;
  return fullData.find(point => filterString === findFilterableValue(point));
};

function findDataColors(fullData, config, queryParts) {
  const firstMeasureName = queryParts.filter(x => x.isFirstMeasure)[0].name;

  const firstMeasureValues = fullData.map((point, i) => {
    return point[firstMeasureName] && point[firstMeasureName].value;
  });

  if (!config.colorRange) return [];

  const colorCount = config.colorRange.length;

  const firstMeasureMax = Math.max(...firstMeasureValues);
  const firstMeasureMin = Math.min(...firstMeasureValues);

  const dataColor = firstMeasureValues.map(x => {
    const i = Math.floor(
      ((x - firstMeasureMin) * (colorCount - 1)) /
        (firstMeasureMax - firstMeasureMin)
    );
    return config.colorRange[i];
  });

  return dataColor;
}

function findDataSizes(fullData, config, queryParts) {
  const secondMeasureName = queryParts.filter(x => x.isFirstMeasure)[0].name;

  const secondMeasureValues = fullData.map((point, i) => {
    return point[secondMeasureName] && point[secondMeasureName].value;
  });

  const measureMax = Math.max(...secondMeasureValues);
  const measureMin = Math.min(...secondMeasureValues);

  const dataSize = secondMeasureValues.map(x => {
    return (
      ((x - measureMin) / (measureMax - measureMin)) *
        (config.maxPointSize - config.minPointSize) +
      config.minPointSize
    );
  });

  return dataSize;
}

let lastData;
let lastConfig;

function addPoints(data, map, fullData, config, queryParts) {
  if (!lastData) lastData = data;
  if (!lastConfig) lastConfig = config;
  if (data === lastData && config === lastConfig) return;

  lastData = data;
  lastConfig = config;

  pointsLayer && map.removeLayer(pointsLayer);

  const pointColor = "#dd3333";
  const lineColor = config.lineColor;
  const lineNumber = config.lineNumber;

  const dataColors = findDataColors(fullData, config, queryParts);
  const dataSizes = findDataSizes(fullData, config, queryParts);

  var popupOptions = { maxWidth: 500, autoPan: false };
  var popupContent = (latlng, fullData, queryParts) => {
    const pointData = findSourceDataPoint(latlng, fullData);
    const nonLocationQueryNames = queryParts.filter(x => x.type != "location");
    let popupData = "";
    nonLocationQueryNames.forEach(x => {
      const value = pointData[x.name] && (pointData[x.name].rendered || pointData[x.name].value);
      popupData = popupData + x.label_short + "<br/>" + value + "<br/><br/>";
    });
    return (
      '<div style="padding: 10px 10px 15px, text-align: center"><center>' +
      popupData +
      "</center></div>"
    );
  };

  let circleMarkers = data.map(function(v, i) {
    return L.circleMarker(L.latLng(v), {
      radius: dataSizes[i] || 5,
      color: dataColors[i],
      stroke: false,
      fill: true,
      fillColor: dataColors[i],
      fillOpacity: 0.4,
      interactive: true
    })
      .on("mouseover", e =>
        onHoverAction(e, v.color || lineColor, data, lineNumber)
      )
      .on("click", e =>
        onHoverAction(e, v.color || lineColor, data, lineNumber)
      );
  });
  if (config.showPopup) {
    circleMarkers = circleMarkers.map(x =>
      x.bindPopup(
        x => popupContent(x._latlng, fullData, queryParts),
        popupOptions
      )
    );
  }

  pointsLayer = L.layerGroup(circleMarkers);
  map.addLayer(pointsLayer, "points");
}

function findDistance(a, b) {
  const dx2 = Math.pow(a[0] - b[0], 2);
  const dy2 = Math.pow(a[1] - b[1], 2);
  return Math.pow(dx2 + dy2, 0.5);
}

function sortPoints(points, referencePoint) {
  const pointsWithDistance = points.map(point => {
    return { ...point, distance: findDistance(point, referencePoint) };
  });
  return pointsWithDistance.sort(compareByDistance);
}

function compareByDistance(a, b) {
  if (a.distance < b.distance) return -1;
  if (a.distance > b.distance) return 1;
  return 0;
}

function onHoverAction(e, color, data, lineNumber) {
  // reset the layer when hovering on a new point.
  linesLayer && map.removeLayer(linesLayer);

  const lat = e.target._latlng.lat;
  const lng = e.target._latlng.lng;
  const visiblePoints = data.filter(point => {
    if (point[0] === lat && point[1] === lng) return false;
    const latlng = L.latLng(point[0], point[1]);
    return map.getBounds().contains(latlng);
  });
  const orderedPoints = sortPoints(visiblePoints, [lat, lng]);
  const nearestPoints = orderedPoints.slice(0, lineNumber);
  const allLines = nearestPoints.map(point => {
    return [[lat, lng], [point[0], point[1]]];
  });
  if (allLines.length > 0) {
    linesLayer = L.polyline(allLines, { color: color });
    map.addLayer(linesLayer, "voronoiLines");
    currentPoint = e.containerPoint;
    currentRadius = e.target.options.radius;
  }
}

function isMouseWithinRadius(e, currentPoint, currentRadius) {
  const dx2 = Math.pow(currentPoint.x - e.containerPoint.x, 2);
  const dy2 = Math.pow(currentPoint.y - e.containerPoint.y, 2);
  const distance = Math.pow(dx2 + dy2, 0.5);
  return distance <= currentRadius;
}

function onMouseMoveAction(e) {
  if (currentPoint && !isMouseWithinRadius(e, currentPoint, currentRadius)) {
    currentPoint = null;
    map.removeLayer(linesLayer);
  }
}

function onZoomEndAction(viz) {
  if (!isEqual(map.getZoom(), oldZoom)) {
    viz.trigger("updateConfig", [{ zoom: map.getZoom() }]);
  }
}

function onMoveEndAction(viz) {
  const newLat = map.getCenter().lat;
  const newLng = map.getCenter().lng;

  if (!isEqual(newLat, oldLat) || !isEqual(newLng, oldLng)) {
    viz.trigger("updateConfig", [{ lat: newLat, lng: newLng }]);
  }
}

looker.plugins.visualizations.add(vis);
