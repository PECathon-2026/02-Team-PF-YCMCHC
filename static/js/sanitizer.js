/**
 * Commonplace Dual-Pass HTML Sanitizer & Reader Privacy Guard (sanitizer.js)
 * Implements:
 * - Default blocking of remote images, embeds, audio/video, and iframes
 * - Stripping of script tags, forms, event handlers (onclick, onerror, etc.)
 * - Unsafe URI scheme stripping (javascript:, vbscript:, data:)
 * - Secure link isolation (rel="noopener noreferrer nofollow", target="_blank")
 * - Centralized rendering sink
 */

const DANGEROUS_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object",
  "embed", "applet", "form", "input", "button", "textarea",
  "select", "option", "meta", "link", "base"
]);

const DANGEROUS_ATTRIBUTES = [
  /^on/i, // All onclick, onerror, onload, etc.
  /^formaction$/i,
  /^data-/i // Disallow data attributes that might execute JS in frameworks
];

export function sanitizeHtml(rawHtml, allowRemoteImages = false) {
  if (!rawHtml || typeof rawHtml !== "string") {
    return "";
  }

  // Parse HTML using the browser's native DOMParser in an isolated document
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  // Remove dangerous tags entirely
  doc.querySelectorAll(Array.from(DANGEROUS_TAGS).join(",")).forEach((el) => el.remove());

  // Traverse all elements in the parsed body
  const allElements = doc.body.querySelectorAll("*");
  allElements.forEach((el) => {
    // 1. Remove dangerous or non-allowlisted attributes
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();

      // Check event handlers
      if (DANGEROUS_ATTRIBUTES.some((re) => re.test(name))) {
        el.removeAttribute(name);
        continue;
      }

      // Check unsafe URL schemes in href, src, or action
      if (["href", "src", "action", "cite"].includes(name)) {
        if (val.startsWith("javascript:") || val.startsWith("vbscript:") || val.startsWith("data:")) {
          el.removeAttribute(name);
          continue;
        }
      }
    }

    // 2. Enforce link isolation on <a> tags
    if (el.tagName.toLowerCase() === "a") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer nofollow");
      el.setAttribute("referrerpolicy", "no-referrer");
    }

    // 3. Remote asset boundary: Block images by default unless explicitly allowed
    if (el.tagName.toLowerCase() === "img") {
      if (!allowRemoteImages) {
        const altText = el.getAttribute("alt") || "Remote Image";
        const src = el.getAttribute("src") || "";

        // Replace with privacy-preserving placeholder
        const placeholder = doc.createElement("div");
        placeholder.className = "blocked-image-placeholder";
        placeholder.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#315BFF" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span style="font-weight:600; color:#A0ADC9;">Remote image blocked</span>
          </div>
          <span style="font-size:11px; color:#6E7C9E;">${altText}</span>
        `;
        el.replaceWith(placeholder);
      } else {
        // When allowed, add referrer policy & lazy loading
        el.setAttribute("loading", "lazy");
        el.setAttribute("referrerpolicy", "no-referrer");
        el.style.maxWidth = "100%";
        el.style.height = "auto";
        el.style.borderRadius = "8px";
      }
    }

    // Block video / audio elements
    if (["video", "audio"].includes(el.tagName.toLowerCase())) {
      const notice = doc.createElement("div");
      notice.className = "blocked-image-placeholder";
      notice.textContent = `[Embedded ${el.tagName.toLowerCase()} blocked to prevent remote tracking]`;
      el.replaceWith(notice);
    }
  });

  return doc.body.innerHTML;
}
