/**
 * PEPPE'S PIZZA - Distance & Delivery Pricing Utilities
 * Cost-0 Architecture (No paid APIs)
 */

const RESTAURANT_LAT = [-23.59636];
const RESTAURANT_LNG = [-70.39323];

console.log("distanceUtils cargado correctamente");

window.calculateDistanceKm = function(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    // Return distance in kilometers with 2 decimal precision as requested.
    return parseFloat(distance.toFixed(2));
};

/**
 * Strict Delivery Pricing Table
 * Apply EXACTLY these ranges as requested:
 * 0.0–1.0 km → $2000
 * 1.1–2.0 km → $2500
 * ...
 */
window.getDeliveryPrice = function(distance) {
    if (distance < 0) return null;
    if (distance <= 1.0) return 2000;
    if (distance <= 2.0) return 2500;
    if (distance <= 3.0) return 3000;
    if (distance <= 4.0) return 3500;
    if (distance <= 5.0) return 4000;
    if (distance <= 6.0) return 4500;
    if (distance <= 7.0) return 5000;
    if (distance <= 8.0) return 5500;
    if (distance <= 9.0) return 6000;
    if (distance <= 10.0) return 6500;

    // If distance > 10 km: Return null
    return null;
};
