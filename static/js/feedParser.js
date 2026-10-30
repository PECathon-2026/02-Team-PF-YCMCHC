/**
 * Commonplace Feed Parser & Concurrency Worker (feedParser.js)
 * Implements:
 * - Robust parsing for RSS 2.0, RSS 0.91, RSS 1.0 (RDF), and Atom 1.0
 * - Deterministic entry identity (feed-scoped guid -> canonical link -> hash)
 * - Safe date parsing with null handling (never invented dates)
 * - Bounded refresh concurrency (max 4 concurrent requests)
 * - Fault isolation (malformed or slow feed never breaks healthy feeds or wipes timeline)
 */

export function parseFeedXml(xmlText, subscriptionId, fallbackUrl) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  // Check for parsererror
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`XML Parse Failure: ${parserError.textContent.slice(0, 150)}`);
  }

  const isAtom = xmlDoc.querySelector("feed") !== null;
  const isRss = xmlDoc.querySelector("rss") !== null || xmlDoc.querySelector("channel") !== null;

  if (isAtom) {
    return parseAtomFeed(xmlDoc, subscriptionId, fallbackUrl);
  } else if (isRss) {
    return parseRssFeed(xmlDoc, subscriptionId, fallbackUrl);
  } else {
    throw new Error("Unrecognized feed format: neither RSS nor Atom root element found.");
  }
}

function parseRssFeed(xmlDoc, subscriptionId, fallbackUrl) {
  const channel = xmlDoc.querySelector("channel") || xmlDoc;
  const title = getElementText(channel, "title") || "Untitled Feed";
  const siteUrl = getElementText(channel, "link") || fallbackUrl;

  // Extract self-referencing alias link if available
  let selfFeedUrl = null;
  const atomLinks = channel.querySelectorAll("atom\\:link, link");
  for (const l of atomLinks) {
    if (l.getAttribute("rel") === "self" && l.getAttribute("href")) {
      selfFeedUrl = l.getAttribute("href");
      break;
    }
  }

  const items = xmlDoc.querySelectorAll("item");
  const entries = [];
  const now = Date.now();

  items.forEach((item, index) => {
    const itemTitle = getElementText(item, "title") || "Untitled Article";
    const link = getElementText(item, "link") || "";
    const guid = getElementText(item, "guid") || "";
    const description = getElementText(item, "description") || getElementText(item, "content\\:encoded") || "";
    const author = getElementText(item, "author") || getElementText(item, "dc\\:creator") || "";
    const pubDateStr = getElementText(item, "pubDate") || getElementText(item, "dc\\:date");

    const pubDate = parseDateToEpoch(pubDateStr);

    // Deterministic entry ID
    const entryId = generateDeterministicEntryId(subscriptionId, guid, link, itemTitle, index);

    entries.push({
      id: entryId,
      subscriptionId,
      sourceIdentifier: guid || link || `entry-${index}`,
      canonicalArticleUrl: link || fallbackUrl,
      title: itemTitle,
      author,
      publicationDate: pubDate,
      firstSeenTimestamp: now,
      feedSummaryHtml: description
    });
  });

  return {
    title,
    siteUrl,
    selfFeedUrl,
    entries
  };
}

function parseAtomFeed(xmlDoc, subscriptionId, fallbackUrl) {
  const feed = xmlDoc.querySelector("feed");
  const title = getElementText(feed, "title") || "Untitled Atom Feed";

  let siteUrl = fallbackUrl;
  let selfFeedUrl = null;
  const feedLinks = feed.querySelectorAll("link");
  for (const l of feedLinks) {
    const rel = l.getAttribute("rel");
    const href = l.getAttribute("href");
    if (rel === "self" && href) {
      selfFeedUrl = href;
    } else if ((rel === "alternate" || !rel) && href) {
      siteUrl = href;
    }
  }

  const items = xmlDoc.querySelectorAll("entry");
  const entries = [];
  const now = Date.now();

  items.forEach((item, index) => {
    const itemTitle = getElementText(item, "title") || "Untitled Entry";
    const id = getElementText(item, "id") || "";

    let link = "";
    const entryLinks = item.querySelectorAll("link");
    for (const l of entryLinks) {
      const href = l.getAttribute("href");
      if (href) {
        link = href;
        if (l.getAttribute("rel") === "alternate") break;
      }
    }

    const content = getElementText(item, "content") || getElementText(item, "summary") || "";
    const author = getElementText(item, "author name") || getElementText(item, "author") || "";
    const dateStr = getElementText(item, "published") || getElementText(item, "updated");

    const pubDate = parseDateToEpoch(dateStr);
    const entryId = generateDeterministicEntryId(subscriptionId, id, link, itemTitle, index);

    entries.push({
      id: entryId,
      subscriptionId,
      sourceIdentifier: id || link || `atom-entry-${index}`,
      canonicalArticleUrl: link || fallbackUrl,
      title: itemTitle,
      author,
      publicationDate: pubDate,
      firstSeenTimestamp: now,
      feedSummaryHtml: content
    });
  });

  return {
    title,
    siteUrl,
    selfFeedUrl,
    entries
  };
}

function getElementText(parent, selector) {
  if (!parent) return "";
  const el = parent.querySelector(selector);
  return el ? el.textContent.trim() : "";
}

function parseDateToEpoch(dateStr) {
  if (!dateStr) return null;
  const epoch = Date.parse(dateStr);
  return isNaN(epoch) ? null : epoch;
}

function generateDeterministicEntryId(subscriptionId, guid, link, title, index) {
  // Priority 1: guid/id
  if (guid && guid.length > 3) {
    return `${subscriptionId}::guid::${hashString(guid)}`;
  }
  // Priority 2: link
  if (link && link.length > 8) {
    return `${subscriptionId}::link::${hashString(link)}`;
  }
  // Priority 3: hash of title + index
  return `${subscriptionId}::fp::${hashString(title + index)}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// --- Bounded Refresh Worker Pool (Max 4 Concurrency) ---
export async function refreshAllSubscriptions(subscriptions, onFeedProgress) {
  const CONCURRENCY_LIMIT = 4;
  const results = [];
  const queue = [...subscriptions];

  async function worker() {
    while (queue.length > 0) {
      const sub = queue.shift();
      try {
        const feedData = await fetchSingleFeedWithIsolation(sub);
        results.push({ sub, status: "success", data: feedData });
        if (onFeedProgress) onFeedProgress(sub, "success", feedData);
      } catch (err) {
        results.push({ sub, status: "error", error: err.message });
        if (onFeedProgress) onFeedProgress(sub, "error", err.message);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, subscriptions.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

export async function fetchSingleFeedWithIsolation(sub) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second hard client timeout

  try {
    const fetchUrl = `/api/fetch?url=${encodeURIComponent(sub.resolvedFeedUrl)}`;
    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      cache: "no-store"
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errMsg = `Server returned HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.message) errMsg = errJson.message;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const xmlText = await response.text();
    const finalUrl = response.headers.get("X-Final-Url") || sub.resolvedFeedUrl;
    const redirectHops = response.headers.get("X-Redirect-Hops");

    const parsed = parseFeedXml(xmlText, sub.id, finalUrl);
    parsed.finalUrl = finalUrl;
    parsed.redirectHops = redirectHops ? JSON.parse(redirectHops) : [];

    return parsed;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timed out after 8 seconds.");
    }
    throw err;
  }
}

/**
 * Intelligently resolves any blog URL to its live RSS/Atom feed.
 * Handles homepages, missing schemes, and link autodiscovery.
 */
export async function resolveAndDiscoverFeed(rawUrl) {
  let cleanUrl = rawUrl.trim();
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }

  try {
    const discoverRes = await fetch(`/api/autodiscover?url=${encodeURIComponent(cleanUrl)}`);
    if (discoverRes.ok) {
      const data = await discoverRes.json();
      if (data.found && data.feedUrl) {
        return {
          resolvedFeedUrl: normalizeUrlClient(data.feedUrl),
          suggestedTitle: data.title || "",
          siteUrl: data.siteUrl || cleanUrl
        };
      }
    }
  } catch (_) {
    // Fall back to direct cleanUrl if autodiscover endpoint is unavailable
  }

  return {
    resolvedFeedUrl: normalizeUrlClient(cleanUrl),
    suggestedTitle: "",
    siteUrl: cleanUrl
  };
}

/**
 * Client-side URL normalization mirroring server-side normalize_feed_url_syntactic.
 * - Lowercases hostname, strips www. prefix
 * - Removes default ports (80 for http, 443 for https)
 * - Removes recognized tracking query params
 * - Removes fragment
 * - Preserves path casing and non-tracking params
 */
export function normalizeUrlClient(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  try {
    const url = new URL(rawUrl.trim());
    // Lowercase hostname, strip www.
    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    // Remove default ports
    let port = "";
    if (
      (url.protocol === "https:" && url.port && url.port !== "443") ||
      (url.protocol === "http:" && url.port && url.port !== "80")
    ) {
      port = ":" + url.port;
    }
    // Remove tracking params
    const TRACKING_PARAMS = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid", "ref", "mc_eid", "ck_subscriber_id", "source", "via"
    ]);
    const searchParams = new URLSearchParams();
    for (const [k, v] of url.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) searchParams.append(k, v);
    }
    const queryStr = searchParams.toString();
    // Fragment is automatically excluded (url.pathname excludes it)
    return `${url.protocol}//${hostname}${port}${url.pathname}${queryStr ? "?" + queryStr : ""}`;
  } catch (e) {
    return rawUrl;
  }
}
