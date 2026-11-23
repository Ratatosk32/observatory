const Z = (label, lat, lon) => ({ label, lat, lon });

export const ZONES = {
  'Europe/London': Z('London', 51.5, -0.1), 'Europe/Dublin': Z('Dublin', 53.3, -6.3), 'Europe/Lisbon': Z('Lisbon', 38.7, -9.1),
  'Europe/Madrid': Z('Madrid', 40.4, -3.7), 'Europe/Paris': Z('Paris', 48.9, 2.4), 'Europe/Brussels': Z('Brussels', 50.8, 4.4),
  'Europe/Amsterdam': Z('Amsterdam', 52.4, 4.9), 'Europe/Berlin': Z('Berlin', 52.5, 13.4), 'Europe/Zurich': Z('Zurich', 47.4, 8.5),
  'Europe/Rome': Z('Rome', 41.9, 12.5), 'Europe/Vienna': Z('Vienna', 48.2, 16.4), 'Europe/Prague': Z('Prague', 50.1, 14.4),
  'Europe/Warsaw': Z('Warsaw', 52.2, 21.0), 'Europe/Budapest': Z('Budapest', 47.5, 19.0), 'Europe/Stockholm': Z('Stockholm', 59.3, 18.1),
  'Europe/Oslo': Z('Oslo', 59.9, 10.8), 'Europe/Copenhagen': Z('Copenhagen', 55.7, 12.6), 'Europe/Helsinki': Z('Helsinki', 60.2, 24.9),
  'Europe/Athens': Z('Athens', 38.0, 23.7), 'Europe/Istanbul': Z('Istanbul', 41.0, 29.0), 'Europe/Kiev': Z('Kyiv', 50.5, 30.5),
  'Europe/Kyiv': Z('Kyiv', 50.5, 30.5), 'Europe/Moscow': Z('Moscow', 55.8, 37.6), 'Europe/Bucharest': Z('Bucharest', 44.4, 26.1),
  'Atlantic/Canary': Z('Tenerife', 28.3, -16.5), 'Atlantic/Reykjavik': Z('Reykjavik', 64.1, -21.9),
  'America/New_York': Z('New York', 40.7, -74.0), 'America/Toronto': Z('Toronto', 43.7, -79.4), 'America/Chicago': Z('Chicago', 41.9, -87.6),
  'America/Denver': Z('Denver', 39.7, -105.0), 'America/Phoenix': Z('Tucson', 32.2, -110.9), 'America/Los_Angeles': Z('Los Angeles', 34.1, -118.2),
  'America/Vancouver': Z('Vancouver', 49.3, -123.1), 'America/Anchorage': Z('Anchorage', 61.2, -149.9), 'Pacific/Honolulu': Z('Honolulu', 21.3, -157.9),
  'America/Mexico_City': Z('Mexico City', 19.4, -99.1), 'America/Bogota': Z('Bogotá', 4.7, -74.1), 'America/Lima': Z('Lima', -12.0, -77.0),
  'America/Caracas': Z('Caracas', 10.5, -66.9), 'America/Santiago': Z('Santiago', -33.4, -70.7), 'America/Argentina/Buenos_Aires': Z('Buenos Aires', -34.6, -58.4),
  'America/Montevideo': Z('Montevideo', -34.9, -56.2), 'America/Sao_Paulo': Z('São Paulo', -23.6, -46.6), 'America/La_Paz': Z('La Paz', -16.5, -68.1),
  'America/Halifax': Z('Halifax', 44.6, -63.6), 'America/Havana': Z('Havana', 23.1, -82.4), 'America/Panama': Z('Panama', 9.0, -79.5),
  'America/Edmonton': Z('Edmonton', 53.5, -113.5), 'America/Winnipeg': Z('Winnipeg', 49.9, -97.1), 'America/Puerto_Rico': Z('San Juan', 18.5, -66.1),
  'Africa/Johannesburg': Z('Johannesburg', -26.2, 28.0), 'Africa/Cairo': Z('Cairo', 30.0, 31.2), 'Africa/Lagos': Z('Lagos', 6.5, 3.4),
  'Africa/Nairobi': Z('Nairobi', -1.3, 36.8), 'Africa/Casablanca': Z('Casablanca', 33.6, -7.6), 'Africa/Windhoek': Z('Windhoek', -22.6, 17.1),
  'Africa/Algiers': Z('Algiers', 36.8, 3.1), 'Africa/Addis_Ababa': Z('Addis Ababa', 9.0, 38.7), 'Africa/Accra': Z('Accra', 5.6, -0.2),
  'Asia/Tokyo': Z('Tokyo', 35.7, 139.7), 'Asia/Seoul': Z('Seoul', 37.6, 127.0), 'Asia/Shanghai': Z('Beijing', 39.9, 116.4),
  'Asia/Hong_Kong': Z('Hong Kong', 22.3, 114.2), 'Asia/Taipei': Z('Taipei', 25.0, 121.6), 'Asia/Singapore': Z('Singapore', 1.3, 103.8),
  'Asia/Bangkok': Z('Bangkok', 13.8, 100.5), 'Asia/Jakarta': Z('Jakarta', -6.2, 106.8), 'Asia/Manila': Z('Manila', 14.6, 121.0),
  'Asia/Kolkata': Z('Mumbai', 19.1, 72.9), 'Asia/Calcutta': Z('Mumbai', 19.1, 72.9), 'Asia/Karachi': Z('Karachi', 24.9, 67.0),
  'Asia/Dubai': Z('Dubai', 25.2, 55.3), 'Asia/Tehran': Z('Tehran', 35.7, 51.4), 'Asia/Jerusalem': Z('Jerusalem', 31.8, 35.2),
  'Asia/Riyadh': Z('Riyadh', 24.7, 46.7), 'Asia/Tashkent': Z('Tashkent', 41.3, 69.2), 'Asia/Almaty': Z('Almaty', 43.2, 76.9),
  'Asia/Kathmandu': Z('Kathmandu', 27.7, 85.3), 'Asia/Dhaka': Z('Dhaka', 23.8, 90.4), 'Asia/Ho_Chi_Minh': Z('Ho Chi Minh City', 10.8, 106.7),
  'Asia/Novosibirsk': Z('Novosibirsk', 55.0, 82.9), 'Asia/Vladivostok': Z('Vladivostok', 43.1, 131.9), 'Asia/Yekaterinburg': Z('Yekaterinburg', 56.8, 60.6),
  'Australia/Sydney': Z('Sydney', -33.9, 151.2), 'Australia/Melbourne': Z('Melbourne', -37.8, 145.0), 'Australia/Brisbane': Z('Brisbane', -27.5, 153.0),
  'Australia/Perth': Z('Perth', -31.95, 115.9), 'Australia/Adelaide': Z('Adelaide', -34.9, 138.6), 'Australia/Hobart': Z('Hobart', -42.9, 147.3),
  'Australia/Darwin': Z('Darwin', -12.5, 130.8), 'Pacific/Auckland': Z('Auckland', -36.85, 174.8), 'Pacific/Fiji': Z('Suva', -18.1, 178.4),
};

export const RUBIN = { label: 'Rubin’s site in Chile', lat: -30.24, lon: -70.74 };

export const PICK = [
  Z('La Serena', -29.9, -71.25), Z('Santiago', -33.4, -70.7), Z('Sydney', -33.9, 151.2), Z('Cape Town', -33.9, 18.4),
  Z('Johannesburg', -26.2, 28.0), Z('São Paulo', -23.6, -46.6), Z('Buenos Aires', -34.6, -58.4), Z('Perth', -31.95, 115.9),
  Z('Auckland', -36.85, 174.8), Z('Honolulu', 21.3, -157.9), Z('Mexico City', 19.4, -99.1), Z('Austin', 30.3, -97.7),
  Z('Tucson', 32.2, -110.9), Z('Miami', 25.8, -80.2), Z('Tenerife', 28.3, -16.5), Z('Cairo', 30.0, 31.2),
  Z('Madrid', 40.4, -3.7), Z('Rome', 41.9, 12.5), Z('Paris', 48.9, 2.4), Z('London', 51.5, -0.1),
  Z('Berlin', 52.5, 13.4), Z('Moscow', 55.8, 37.6), Z('Mumbai', 19.1, 72.9), Z('Tokyo', 35.7, 139.7),
  Z('Beijing', 39.9, 116.4), Z('New York', 40.7, -74.0), Z('Toronto', 43.7, -79.4), Z('Denver', 39.7, -105.0),
  Z('Edinburgh', 55.95, -3.2), Z('Helsinki', 60.2, 24.9),
];

export function guessSite() {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const z = ZONES[zone];
  return z ? { ...z, src: 'tz' } : { ...RUBIN, src: 'tz-unknown' };
}
