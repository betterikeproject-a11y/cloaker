const express = require('express');
const { UAParser } = require('ua-parser-js');
const db = require('../db');
const { getClientIp, lookupIp } = require('../geo');
const { evaluate } = require('../filter');

const router = express.Router();

function mergeParams(baseUrl, incomingQuery) {
  const entries = Object.entries(incomingQuery);
  if (entries.length === 0) return baseUrl;

  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const sep = baseUrl.includes('?') ? '&' : '?';
  return baseUrl + sep + qs;
}

function parseUa(userAgent) {
  if (!userAgent) return { os: 'Unknown', browser: 'Unknown', browserVersion: '', device: 'desktop' };

  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  const os = result.os.name || 'Unknown';
  const browser = result.browser.name || 'Unknown';
  const browserVersion = result.browser.version || '';

  let device = 'desktop';
  if (result.device.type === 'mobile') device = 'mobile';
  else if (result.device.type === 'tablet') device = 'tablet';

  return { os, browser, browserVersion, device };
}

router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  const campaign = db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(slug);

  if (!campaign) {
    return res.status(404).send(`
      <!DOCTYPE html><html><head><title>Not Found</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>404 — Page not found</h2>
        <p>The requested campaign does not exist.</p>
      </body></html>
    `);
  }

  const ip = getClientIp(req);
  const uaString = req.headers['user-agent'] || '';
  const uaData = parseUa(uaString);
  const originalQuery = req.query;
  const referrer = req.headers['referer'] || req.headers['referrer'] || null;
  const urlParams = Object.keys(originalQuery).length > 0 ? JSON.stringify(originalQuery) : null;

  // Campaign is inactive: send to safe page, no logging needed
  if (!campaign.status) {
    const target = mergeParams(campaign.safe_url, originalQuery);
    return res.redirect(302, target);
  }

  // Geo lookup
  const geoData = await lookupIp(ip);

  // Parse filters
  let filters = {};
  try {
    filters = JSON.parse(campaign.filters);
  } catch (_) {}

  // Evaluate filters
  const { approved, reason } = evaluate(filters, geoData, uaData, originalQuery);

  // Log the request
  try {
    db.prepare(`
      INSERT INTO requests
        (campaign_id, campaign_name, ip, country, region, city, isp,
         is_proxy, is_vpn, is_hosting, device, os, browser, browser_version,
         approved, block_reason, user_agent, referrer, url_params)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      campaign.name,
      ip,
      geoData.country,
      geoData.regionName,
      geoData.city,
      geoData.isp,
      geoData.proxy ? 1 : 0,
      geoData.vpn ? 1 : 0,
      geoData.hosting ? 1 : 0,
      uaData.device,
      uaData.os,
      uaData.browser,
      uaData.browserVersion,
      approved ? 1 : 0,
      reason || null,
      uaString || null,
      referrer,
      urlParams
    );
  } catch (logErr) {
    console.error('[redirect] failed to log request:', logErr.message);
  }

  // Strip the security token before forwarding — never expose it to offer/safe pages
  const forwardQuery = { ...originalQuery };
  if (filters.token_param && filters.token_param.trim()) {
    delete forwardQuery[filters.token_param.trim()];
  }

  const targetUrl = approved ? campaign.offer_url : campaign.safe_url;
  const destination = mergeParams(targetUrl, forwardQuery);

  return res.redirect(302, destination);
});

module.exports = router;
