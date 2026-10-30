/**
 * Centralized Article Reader & Sanitized Render Sink (articleViewer.js)
 * Implements:
 * - Single reviewed rendering sink for article content
 * - Full-text extraction with graceful feed-summary fallback
 * - Offline readiness label ("Full article saved", "Summary only", "Requires network")
 * - Per-article "Load remote images" action with privacy disclosure
 * - Local reading bookmark restoring scroll position
 * - Views count and interactive Likes count with animation
 * - Interactive Reading Notes & Quote Selection
 * - Similar Articles & Related Blogs headlines at the end
 */

import { sanitizeHtml } from "./sanitizer.js";
import {
  getCachedArticle,
  putCachedArticle,
  setReadingState,
  getReadingState,
  recordArticleView,
  toggleArticleLike,
  getArticleEngagement,
  getNotesForEntry,
  putNote,
  deleteNote
} from "./db.js";

export class ArticleViewer {
  constructor(readerContainerEl, onStateChange, onSelectRelatedArticle) {
    this.container = readerContainerEl;
    this.onStateChange = onStateChange;
    this.onSelectRelatedArticle = onSelectRelatedArticle;
    this.currentEntry = null;
    this.currentArticleData = null;
    this.allowRemoteImages = false;
    this.activeQuote = "";

    this.renderSkeleton();
  }

  renderSkeleton() {
    this.container.innerHTML = `
      <div class="reader-header">
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="reader-close-btn" class="btn btn-outline" style="padding:6px 10px;" title="Close Reader (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <span id="reader-readiness-pill" class="pill pill-summary-only">Checking...</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <!-- Like Button & Count -->
          <button id="reader-like-btn" class="btn btn-outline" style="padding:6px 12px; gap:6px;" title="Like this article">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <span id="reader-likes-count">0</span>
          </button>

          <button id="reader-save-btn" class="btn btn-outline" style="padding:6px 12px;">Save</button>
          <button id="reader-toggle-read-btn" class="btn btn-outline" style="padding:6px 12px;">Mark Read</button>
          <a id="reader-source-link" href="#" target="_blank" rel="noopener noreferrer nofollow" class="btn btn-outline" style="padding:6px 10px;" title="Open original website">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
        <div class="reader-progress-bar" id="reader-progress-bar"></div>
      </div>

      <div class="bookmark-ribbon-3d" id="reader-bookmark-ribbon" title="Click to pin/restore reading bookmark"></div>

      <div class="reader-scrollable" id="reader-scrollable">
        <div class="reader-meta-box">
          <h1 class="reader-article-title" id="reader-article-title">Select an article</h1>
          <div class="reader-sub-meta">
            <span id="reader-author" style="color:var(--text-secondary); font-weight:600;"></span>
            <span id="reader-date"></span>
            <span id="reader-source-name" style="color:var(--electric-cobalt-light);"></span>
            <span class="pill pill-offline-unavailable" id="reader-views-pill" style="gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <span id="reader-views-count">0 views</span>
            </span>
          </div>
        </div>

        <div id="reader-privacy-banner" class="privacy-isolation-banner" style="display:none;">
          <div class="privacy-text">
            <strong>Privacy Boundary:</strong> Remote assets are blocked. The upstream host cannot track this view.
          </div>
          <button id="reader-load-images-btn" class="btn btn-primary" style="padding:4px 10px; font-size:11px;">
            Load Remote Images
          </button>
        </div>

        <!-- Centralized Sanitized HTML Rendering Sink -->
        <article class="article-rendered-content" id="reader-content-sink"></article>

        <!-- Reading Notes & Annotations Section -->
        <section class="reader-notes-section">
          <div class="notes-header-row">
            <div style="display:flex; align-items:center; gap:8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--acid-lime)" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <h3 style="font-size:16px; font-weight:700; color:#FFFFFF;">Reading Notes & Highlights</h3>
            </div>
            <button id="btn-quote-selection" class="btn btn-outline" style="font-size:11px; padding:3px 8px;">
              + Quote Selected Text
            </button>
          </div>

          <div id="quote-preview-box" class="quote-preview-box" style="display:none;">
            <div style="font-size:12px; font-style:italic; color:var(--acid-lime);" id="quote-preview-text"></div>
            <button id="btn-cancel-quote" class="btn-cancel-quote">✕</button>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
            <textarea id="note-input-text" class="note-textarea" placeholder="Write personal reflections, ideas, or observations on this article..." rows="2"></textarea>
            <div style="display:flex; justify-content:flex-end;">
              <button id="btn-save-note" class="btn btn-lime" style="padding:5px 14px; font-size:12px;">
                Save Note
              </button>
            </div>
          </div>

          <div id="article-notes-list" class="article-notes-list"></div>
        </section>

        <!-- Similar Articles & Related Blogs Section -->
        <section class="similar-blogs-section" id="similar-blogs-container">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--electric-cobalt-light)" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <h3 style="font-size:16px; font-weight:700; color:#FFFFFF;">Related Headlines & Similar Blogs</h3>
          </div>
          <div id="similar-articles-list" class="similar-articles-list"></div>
        </section>

      </div>
    `;

    // Event Listeners
    this.scrollEl = this.container.querySelector("#reader-scrollable");
    this.progressBar = this.container.querySelector("#reader-progress-bar");
    this.bookmarkRibbon = this.container.querySelector("#reader-bookmark-ribbon");
    this.contentSink = this.container.querySelector("#reader-content-sink");

    this.container.querySelector("#reader-close-btn").addEventListener("click", () => this.close());
    this.container.querySelector("#reader-save-btn").addEventListener("click", () => this.toggleSaved());
    this.container.querySelector("#reader-toggle-read-btn").addEventListener("click", () => this.toggleRead());
    this.container.querySelector("#reader-load-images-btn").addEventListener("click", () => this.handleLoadRemoteImages());
    this.bookmarkRibbon.addEventListener("click", () => this.handleBookmarkPin());

    // Likes & Views listeners
    this.container.querySelector("#reader-like-btn").addEventListener("click", () => this.handleLikeClick());

    // Notes listeners
    this.container.querySelector("#btn-quote-selection").addEventListener("click", () => this.handleCaptureSelection());
    this.container.querySelector("#btn-cancel-quote").addEventListener("click", () => this.clearActiveQuote());
    this.container.querySelector("#btn-save-note").addEventListener("click", () => this.handleSaveNote());

    // Scroll progress & local bookmark tracking
    this.scrollEl.addEventListener("scroll", () => {
      this.updateScrollProgress();
    });
  }

  async loadArticle(entry, subscriptionTitle = "", allEntries = []) {
    this.currentEntry = entry;
    this.allowRemoteImages = false;
    this.activeQuote = "";
    this.clearActiveQuote();
    this.container.classList.remove("hidden");

    // Populate headers
    this.container.querySelector("#reader-article-title").textContent = entry.title || "Untitled";
    this.container.querySelector("#reader-author").textContent = entry.author ? `By ${entry.author}` : "";
    this.container.querySelector("#reader-source-name").textContent = subscriptionTitle ? `• ${subscriptionTitle}` : "";

    const dateStr = entry.publicationDate
      ? new Date(entry.publicationDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "Undated";
    this.container.querySelector("#reader-date").textContent = dateStr;

    const sourceLink = this.container.querySelector("#reader-source-link");
    sourceLink.href = entry.canonicalArticleUrl;

    // Record view & load engagement metrics
    const engagement = await recordArticleView(entry.id);
    this.updateEngagementUI(engagement);

    // Check reading state & auto-mark read
    const readingState = await getReadingState(entry.id);
    const isSaved = readingState ? readingState.isSaved : false;
    await setReadingState(entry.id, { isRead: true });
    this.updateActionButtons(isSaved, true);

    // Retrieve from cache or extract
    await this.resolveAndRenderContent(entry);

    // Load notes for this article
    await this.renderArticleNotes(entry.id);

    // Load similar articles & related blogs at the end
    this.renderSimilarArticles(entry, allEntries);

    // Restore scroll bookmark position if stored
    if (readingState && readingState.scrollProgress > 0) {
      setTimeout(() => {
        const targetScroll = (this.scrollEl.scrollHeight - this.scrollEl.clientHeight) * readingState.scrollProgress;
        this.scrollEl.scrollTop = targetScroll;
        this.bookmarkRibbon.classList.add("pinned");
      }, 50);
    } else {
      this.scrollEl.scrollTop = 0;
      this.bookmarkRibbon.classList.remove("pinned");
    }

    if (this.onStateChange) this.onStateChange(entry.id);
  }

  async handleLikeClick() {
    if (!this.currentEntry) return;
    const engagement = await toggleArticleLike(this.currentEntry.id);
    this.updateEngagementUI(engagement);
    if (this.onStateChange) this.onStateChange(this.currentEntry.id);
  }

  updateEngagementUI(engagement) {
    const likeBtn = this.container.querySelector("#reader-like-btn");
    const likesCountEl = this.container.querySelector("#reader-likes-count");
    const viewsCountEl = this.container.querySelector("#reader-views-count");

    if (likesCountEl) likesCountEl.textContent = `${engagement.likesCount}`;
    if (viewsCountEl) viewsCountEl.textContent = `${engagement.viewsCount} views`;

    if (likeBtn) {
      likeBtn.classList.toggle("active", engagement.isLiked);
      likeBtn.style.color = engagement.isLiked ? "var(--acid-lime)" : "var(--text-primary)";
      likeBtn.style.borderColor = engagement.isLiked ? "var(--acid-lime)" : "var(--midnight-border)";
      const svgPath = likeBtn.querySelector("svg path");
      if (svgPath) {
        svgPath.setAttribute("fill", engagement.isLiked ? "currentColor" : "none");
      }
    }
  }

  handleCaptureSelection() {
    const selection = window.getSelection().toString().trim();
    if (!selection) {
      alert("Please highlight/select some text from the article first.");
      return;
    }
    this.activeQuote = selection;
    const quoteBox = this.container.querySelector("#quote-preview-box");
    const quoteText = this.container.querySelector("#quote-preview-text");
    quoteText.textContent = `“${selection}”`;
    quoteBox.style.display = "flex";
  }

  clearActiveQuote() {
    this.activeQuote = "";
    const quoteBox = this.container.querySelector("#quote-preview-box");
    if (quoteBox) quoteBox.style.display = "none";
  }

  async handleSaveNote() {
    if (!this.currentEntry) return;
    const textarea = this.container.querySelector("#note-input-text");
    const noteText = textarea.value.trim();

    if (!noteText && !this.activeQuote) {
      alert("Please enter a note or quote some text.");
      return;
    }

    const note = {
      entryId: this.currentEntry.id,
      articleTitle: this.currentEntry.title,
      articleUrl: this.currentEntry.canonicalArticleUrl,
      author: this.currentEntry.author || "",
      noteText,
      quoteText: this.activeQuote,
      timestamp: Date.now()
    };

    await putNote(note);
    textarea.value = "";
    this.clearActiveQuote();
    await this.renderArticleNotes(this.currentEntry.id);
  }

  async renderArticleNotes(entryId) {
    const listEl = this.container.querySelector("#article-notes-list");
    if (!listEl) return;

    const notes = await getNotesForEntry(entryId);
    listEl.innerHTML = "";

    if (notes.length === 0) {
      listEl.innerHTML = `<p style="font-size:12px; color:var(--text-dim); font-style:italic;">No notes taken for this article yet.</p>`;
      return;
    }

    notes.sort((a, b) => b.timestamp - a.timestamp);
    notes.forEach((note) => {
      const card = document.createElement("div");
      card.className = "note-entry-card";
      const timeStr = new Date(note.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11px; font-family:var(--font-mono); color:var(--text-muted);">${timeStr}</span>
          <button class="btn btn-danger" style="padding:2px 6px; font-size:10px;" data-delete-note="${note.id}">Delete</button>
        </div>
        ${note.quoteText ? `<blockquote style="border-left:2px solid var(--acid-lime); padding-left:8px; margin-bottom:8px; font-size:12px; color:var(--acid-lime); font-style:italic;">“${note.quoteText}”</blockquote>` : ''}
        ${note.noteText ? `<div style="font-size:13px; color:var(--text-primary); line-height:1.4;">${note.noteText}</div>` : ''}
      `;

      card.querySelector(`[data-delete-note="${note.id}"]`).addEventListener("click", async () => {
        await deleteNote(note.id);
        await this.renderArticleNotes(entryId);
      });

      listEl.appendChild(card);
    });
  }

  renderSimilarArticles(currentEntry, allEntries = []) {
    const listEl = this.container.querySelector("#similar-articles-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    // Find other articles from same subscription or author
    const similar = allEntries
      .filter((e) => e.id !== currentEntry.id && (e.subscriptionId === currentEntry.subscriptionId || (e.author && e.author === currentEntry.author)))
      .slice(0, 4);

    if (similar.length === 0) {
      listEl.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">No more articles from this publication currently cached.</p>`;
      return;
    }

    similar.forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "similar-article-card";
      const dateStr = item.publicationDate
        ? new Date(item.publicationDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "Recent";

      itemEl.innerHTML = `
        <div style="font-size:11px; color:var(--electric-cobalt-light); font-family:var(--font-mono);">${dateStr}</div>
        <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin:4px 0;">${item.title}</div>
        <div style="font-size:12px; color:var(--text-muted); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
          ${item.feedSummaryHtml.replace(/<[^>]*>/g, '').slice(0, 100)}...
        </div>
      `;

      itemEl.addEventListener("click", () => {
        if (this.onSelectRelatedArticle) {
          this.onSelectRelatedArticle(item);
        }
      });

      listEl.appendChild(itemEl);
    });
  }

  async resolveAndRenderContent(entry) {
    const readinessPill = this.container.querySelector("#reader-readiness-pill");
    const privacyBanner = this.container.querySelector("#reader-privacy-banner");

    // 1. Check if cached article exists in IndexedDB
    const cached = await getCachedArticle(entry.id);
    if (cached) {
      this.currentArticleData = cached;
      readinessPill.className = "pill pill-saved-full";
      readinessPill.textContent = "Full article saved";
      privacyBanner.style.display = "flex";
      this.renderContent(cached.sanitizedContentHtml);
      return;
    }

    // 2. If online, attempt full-text extraction via /api/fetch
    if (navigator.onLine) {
      readinessPill.className = "pill pill-summary-only";
      readinessPill.textContent = "Extracting full text...";

      try {
        const fullTextHtml = await this.extractReadableArticle(entry.canonicalArticleUrl);
        if (fullTextHtml && fullTextHtml.length > entry.feedSummaryHtml.length) {
          const cachedRecord = {
            entryId: entry.id,
            sanitizedContentHtml: fullTextHtml,
            extractionSource: "fulltext",
            cachedTimestamp: Date.now(),
            sanitizationPolicyVersion: 1,
            hasRemoteAssetsBlocked: true
          };
          await putCachedArticle(cachedRecord);
          this.currentArticleData = cachedRecord;

          readinessPill.className = "pill pill-saved-full";
          readinessPill.textContent = "Full article saved";
          privacyBanner.style.display = "flex";
          this.renderContent(fullTextHtml);
          return;
        }
      } catch (err) {
        console.warn("Full text extraction failed, falling back to feed summary:", err);
      }
    }

    // 3. Fallback to sanitized feed summary
    readinessPill.className = "pill pill-summary-only";
    readinessPill.textContent = "Summary only";
    privacyBanner.style.display = "flex";

    const fallbackHtml = entry.feedSummaryHtml || "<p><em>No article content or feed summary available.</em></p>";
    this.renderContent(fallbackHtml);
  }

  async extractReadableArticle(url) {
    const fetchUrl = `/api/fetch?url=${encodeURIComponent(url)}`;
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const htmlText = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    const articleTag = doc.querySelector("article");
    if (articleTag) {
      return articleTag.innerHTML;
    }

    const mainTag = doc.querySelector("main") || doc.querySelector(".post-content") || doc.querySelector(".entry-content");
    if (mainTag) {
      return mainTag.innerHTML;
    }

    return doc.body.innerHTML;
  }

  renderContent(html) {
    const sanitized = sanitizeHtml(html, this.allowRemoteImages);
    this.contentSink.innerHTML = sanitized;
  }

  handleLoadRemoteImages() {
    this.allowRemoteImages = true;
    this.container.querySelector("#reader-privacy-banner").style.display = "none";
    if (this.currentArticleData) {
      this.renderContent(this.currentArticleData.sanitizedContentHtml);
    } else if (this.currentEntry) {
      this.renderContent(this.currentEntry.feedSummaryHtml);
    }
  }

  async toggleSaved() {
    if (!this.currentEntry) return;
    const current = await getReadingState(this.currentEntry.id);
    const newSaved = !Boolean(current && current.isSaved);
    await setReadingState(this.currentEntry.id, { isSaved: newSaved });

    if (newSaved) {
      const existingCache = await getCachedArticle(this.currentEntry.id);
      if (!existingCache) {
        await putCachedArticle({
          entryId: this.currentEntry.id,
          sanitizedContentHtml: this.currentEntry.feedSummaryHtml,
          extractionSource: "feed-summary",
          cachedTimestamp: Date.now(),
          sanitizationPolicyVersion: 1,
          hasRemoteAssetsBlocked: !this.allowRemoteImages
        });
      }
    }

    this.updateActionButtons(newSaved, current ? current.isRead : true);
    if (this.onStateChange) this.onStateChange(this.currentEntry.id);
  }

  async toggleRead() {
    if (!this.currentEntry) return;
    const current = await getReadingState(this.currentEntry.id);
    const newRead = !Boolean(current && current.isRead);
    await setReadingState(this.currentEntry.id, { isRead: newRead });
    this.updateActionButtons(current ? current.isSaved : false, newRead);
    if (this.onStateChange) this.onStateChange(this.currentEntry.id);
  }

  updateActionButtons(isSaved, isRead) {
    const saveBtn = this.container.querySelector("#reader-save-btn");
    const readBtn = this.container.querySelector("#reader-toggle-read-btn");

    if (isSaved) {
      saveBtn.className = "btn btn-lime";
      saveBtn.textContent = "Saved";
    } else {
      saveBtn.className = "btn btn-outline";
      saveBtn.textContent = "Save";
    }

    if (isRead) {
      readBtn.textContent = "Mark Unread";
    } else {
      readBtn.textContent = "Mark Read";
    }
  }

  updateScrollProgress() {
    const total = this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
    if (total <= 0) {
      this.progressBar.style.width = "0%";
      return;
    }
    const progress = Math.min(Math.max(this.scrollEl.scrollTop / total, 0), 1);
    this.progressBar.style.width = `${(progress * 100).toFixed(1)}%`;

    if (this.currentEntry) {
      setReadingState(this.currentEntry.id, { scrollProgress: progress });
    }
  }

  handleBookmarkPin() {
    if (!this.currentEntry) return;
    this.bookmarkRibbon.classList.toggle("pinned");
    this.updateScrollProgress();
  }

  close() {
    this.container.classList.add("hidden");
    this.currentEntry = null;
  }
}
