/**
 * Evaluate campaign filters against visitor data.
 * Returns { approved: boolean, reason: string | null }
 */
function evaluate(filters, geoData, uaData) {
  if (!filters || typeof filters !== 'object') {
    return { approved: true, reason: null };
  }

  const country = (geoData.country || 'XX').toUpperCase();

  // Allowed countries whitelist
  if (Array.isArray(filters.allowed_countries) && filters.allowed_countries.length > 0) {
    const allowed = filters.allowed_countries.map(c => c.toUpperCase());
    if (!allowed.includes(country)) {
      return { approved: false, reason: `country_not_allowed:${country}` };
    }
  }

  // Blocked countries blacklist
  if (Array.isArray(filters.blocked_countries) && filters.blocked_countries.length > 0) {
    const blocked = filters.blocked_countries.map(c => c.toUpperCase());
    if (blocked.includes(country)) {
      return { approved: false, reason: `country_blocked:${country}` };
    }
  }

  // Proxy / VPN / datacenter checks
  if (filters.block_proxy && geoData.proxy) {
    return { approved: false, reason: 'proxy_detected' };
  }

  if (filters.block_vpn && geoData.vpn) {
    return { approved: false, reason: 'vpn_detected' };
  }

  if (filters.block_datacenter && geoData.hosting) {
    return { approved: false, reason: 'datacenter_detected' };
  }

  // OS filters
  const os = (uaData.os || '').toLowerCase();

  if (Array.isArray(filters.allowed_os) && filters.allowed_os.length > 0) {
    const allowedOs = filters.allowed_os.map(o => o.toLowerCase());
    if (!allowedOs.some(o => os.includes(o))) {
      return { approved: false, reason: `os_not_allowed:${uaData.os}` };
    }
  }

  if (Array.isArray(filters.blocked_os) && filters.blocked_os.length > 0) {
    const blockedOs = filters.blocked_os.map(o => o.toLowerCase());
    if (blockedOs.some(o => os.includes(o))) {
      return { approved: false, reason: `os_blocked:${uaData.os}` };
    }
  }

  // Device type filters
  const device = (uaData.device || '').toLowerCase();

  if (Array.isArray(filters.allowed_devices) && filters.allowed_devices.length > 0) {
    const allowedDev = filters.allowed_devices.map(d => d.toLowerCase());
    if (!allowedDev.includes(device)) {
      return { approved: false, reason: `device_not_allowed:${uaData.device}` };
    }
  }

  if (Array.isArray(filters.blocked_devices) && filters.blocked_devices.length > 0) {
    const blockedDev = filters.blocked_devices.map(d => d.toLowerCase());
    if (blockedDev.includes(device)) {
      return { approved: false, reason: `device_blocked:${uaData.device}` };
    }
  }

  return { approved: true, reason: null };
}

module.exports = { evaluate };
