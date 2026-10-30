/**
 * Commonplace Main Application Controller (app.js)
 * High-contrast Midnight Black / Electric Cobalt / Acid Lime aesthetic.
 * Integrates:
 * - Local-first reading timeline, queue, and saved offline storage
 * - Intelligent error-free feed autodiscovery & 1-click curated subscriptions
 * - Fullscreen Instagram Reels / YouTube Shorts snapping feed mode
 * - Persistent Views & Likes counters on all blogs
 * - Similar articles & related headlines at the end of every blog
 * - Recommended subscriptions shelf
 * - Real-time search across headlines, writers, publications, and content
 * - Interactive Reading Notes & Annotations journal
 * - Centralized sanitized reader sink with reading bookmarks
 * - 3D interactive cosmos & tactile tilt
 * - Refresh diagnostics notebook & offline resilience
 */

import {
  getAllSubscriptions,
  putSubscription,
  deleteSubscription,
  getAllEntries,
  putEntries,
  getAllReadingStates,
  setReadingState,
  getSetting,
  setSetting,
  getArticleEngagement,
  toggleArticleLike,
  recordArticleView,
  getAllNotes,
  deleteNote
} from "./db.js";
import {
  parseFeedXml,
  refreshAllSubscriptions,
  fetchSingleFeedWithIsolation,
  resolveAndDiscoverFeed
} from "./feedParser.js";
import { ArticleViewer } from "./articleViewer.js";
import { Cosmos3D, setupCard3dTilt } from "./components/canvas3d.js";
import { showRecommendationReceipt } from "./components/discoveryReceipt.js";
import { exportLocalDataToJson, importLocalDataFromJson } from "./backup.js";

// Curated Popular Publications Directory for 1-Click Error-Free Subscriptions
const CURATED_POPULAR_BLOGS = [
  {
    title: "Simon Willison’s Weblog",
    author: "Simon Willison",
    url: "https://simonwillison.net/atom/everything/",
    category: "Software & AI"
  },
  {
    title: "Dan Luu",
    author: "Dan Luu",
    url: "https://danluu.com/atom.xml",
    category: "Systems & Culture"
  },
  {
    title: "fasterthanli.me",
    author: "Amos Wenger",
    url: "https://fasterthanli.me/index.xml",
    category: "Rust & Deep Tech"
  },
  {
    title: "Wizard Zines",
    author: "Julia Evans",
    url: "https://jvns.ca/atom.xml",
    category: "Linux & Networking"
  },
  {
    title: "Krebs on Security",
    author: "Brian Krebs",
    url: "https://krebsonsecurity.com/feed/",
    category: "Cybersecurity"
  },
  {
    title: "Ars Technica",
    author: "Ars Editorial",
    url: "https://arstechnica.com/feed/",
    category: "Technology News"
  },
  {
    title: "Xe Iaso's Blog",
    author: "Xe Iaso",
    url: "https://xeiaso.net/blog.rss",
    category: "Infrastructure & Life"
  },
  {
    title: "Pluralistic",
    author: "Cory Doctorow",
    url: "https://pluralistic.net/feed/",
    category: "Digital Rights & Tech"
  },
  {
    title: "GitHub Engineering",
    author: "GitHub",
    url: "https://github.blog/feed/",
    category: "Dev & Scale"
  },
  {
    title: "Overreacted",
    author: "Dan Abramov",
    url: "https://overreacted.io/rss.xml",
    category: "React & Web Dev"
  },
  {
    title: "Hacker News Frontpage",
    author: "Y Combinator",
    url: "https://news.ycombinator.com/rss",
    category: "Tech Aggregator"
  }
];

class CommonplaceApp {
  constructor() {
    this.currentView = "timeline"; // 'timeline' | 'queue' | 'saved' | 'shorts' | 'notes' | 'discovery' | 'settings'
    this.subscriptions = [];
    this.entries = [];
    this.readingStates = new Map();
    this.feedDiagnostics = new Map();
    this.cosmos3dInstance = null;
    this.selectedEntryId = null;
    this.searchQuery = "";

    this.init();
  }

  async init() {
    // 1. Register Service Worker for offline shell caching
    this.registerServiceWorker();

    // 2. Initialize Article Viewer sink
    const readerPane = document.getElementById("reader-pane");
    this.articleViewer = new ArticleViewer(
      readerPane,
      async (entryId) => {
        await this.refreshReadingStates();
        this.renderCurrentView();
        this.updateSidebarCounters();
      },
      (relatedEntry) => {
        const subTitle = this.getSubscriptionTitle(relatedEntry.subscriptionId);
        this.openEntryInReader(relatedEntry, subTitle);
      }
    );

    // 3. Bind UI Events & Keyboard Shortcuts
    this.bindDomEvents();
    this.bindKeyboardShortcuts();
    this.initNetworkStatusListener();

    // 4. Load persisted data from IndexedDB
    await this.loadPersistedData();

    // 5. Seed initial subscriptions if empty
    if (this.subscriptions.length === 0) {
      await this.seedInitialSubscriptions();
    }

    // 6. Initial render & counter updates
    this.renderCurrentView();
    this.renderRecommendedShelf();
    this.updateSidebarCounters();
  }

  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        console.log("Commonplace Service Worker active, scope:", reg.scope);
      }).catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });
    }
  }

  initNetworkStatusListener() {
    const indicator = document.getElementById("online-status-indicator");
    const statusText = document.getElementById("online-status-text");

    const updateStatus = () => {
      const isOnline = navigator.onLine;
      if (indicator && statusText) {
        indicator.className = `status-indicator ${isOnline ? 'status-online' : 'status-offline'}`;
        statusText.textContent = isOnline ? "Online" : "Offline Mode";
      }
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    updateStatus();
  }

  async loadPersistedData() {
    this.subscriptions = await getAllSubscriptions();
    this.entries = await getAllEntries();
    await this.refreshReadingStates();
  }

  async refreshReadingStates() {
    this.readingStates = await getAllReadingStates();
  }

  getSubscriptionTitle(subscriptionId) {
    const sub = this.subscriptions.find((s) => s.id === subscriptionId);
    return sub ? sub.title : "Feed";
  }

  async seedInitialSubscriptions() {
    const starterFeeds = [
      {
        id: "sub-simonw",
        enteredUrl: "https://simonwillison.net/atom/everything/",
        resolvedFeedUrl: "https://simonwillison.net/atom/everything/",
        siteUrl: "https://simonwillison.net/",
        title: "Simon Willison’s Weblog",
        refreshStatus: "idle"
      },
      {
        id: "sub-danluu",
        enteredUrl: "https://danluu.com/atom.xml",
        resolvedFeedUrl: "https://danluu.com/atom.xml",
        siteUrl: "https://danluu.com/",
        title: "Dan Luu",
        refreshStatus: "idle"
      }
    ];

    for (const sub of starterFeeds) {
      await putSubscription(sub);
    }
    this.subscriptions = await getAllSubscriptions();
  }

  bindDomEvents() {
    // Navigation items
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        const view = item.dataset.view;
        if (view) this.switchView(view);
      });
    });

    // Shorts toggle button in topbar
    const toggleShortsBtn = document.getElementById("btn-toggle-shorts");
    if (toggleShortsBtn) {
      toggleShortsBtn.addEventListener("click", () => {
        if (this.currentView === "shorts") {
          this.switchView("timeline");
        } else {
          this.switchView("shorts");
        }
      });
    }

    // Refresh All Feeds
    document.getElementById("btn-refresh-all").addEventListener("click", () => {
      this.handleRefreshAllFeeds();
    });

    // Add Feed Button -> Interactive Modal with Autodiscovery & Curated Blogs
    document.getElementById("btn-add-feed").addEventListener("click", () => {
      this.showAddFeedModal();
    });

    // Share Batch Button (Discovery)
    document.getElementById("btn-share-batch").addEventListener("click", () => {
      this.handleExplicitBatchShare();
    });

    // Refresh Diagnostics Notebook Drawer
    document.getElementById("btn-open-notebook").addEventListener("click", () => {
      this.toggleNotebookDrawer(true);
    });
    document.getElementById("notebook-close-btn").addEventListener("click", () => {
      this.toggleNotebookDrawer(false);
    });

    // Global Search Input
    const searchInput = document.getElementById("global-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.renderCurrentView();
      });
    }

    // Export Notes Button (in Notes Journal)
    const exportNotesBtn = document.getElementById("btn-export-notes");
    if (exportNotesBtn) {
      exportNotesBtn.addEventListener("click", () => this.exportNotesAsMarkdown());
    }

    // Discovery Sub-tabs ('related' vs 'popular')
    const recTabRelated = document.getElementById("tab-rec-related");
    const recTabPopular = document.getElementById("tab-rec-popular");
    if (recTabRelated && recTabPopular) {
      recTabRelated.addEventListener("click", () => {
        recTabRelated.classList.add("btn-primary");
        recTabRelated.classList.remove("btn-outline");
        recTabPopular.classList.remove("btn-primary");
        recTabPopular.classList.add("btn-outline");
        this.loadDiscoveryRecommendations("related");
      });
      recTabPopular.addEventListener("click", () => {
        recTabPopular.classList.add("btn-primary");
        recTabPopular.classList.remove("btn-outline");
        recTabRelated.classList.remove("btn-primary");
        recTabRelated.classList.add("btn-outline");
        this.loadDiscoveryRecommendations("popular");
      });
    }

    // Backup & Restore
    const exportBtn = document.getElementById("btn-export-backup");
    const importInput = document.getElementById("input-import-backup");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportLocalDataToJson());
    }
    if (importInput) {
      importInput.addEventListener("change", async (e) => {
        if (e.target.files && e.target.files[0]) {
          try {
            const res = await importLocalDataFromJson(e.target.files[0]);
            alert(`Restored ${res.count} subscriptions successfully.`);
            await this.loadPersistedData();
            this.renderCurrentView();
            this.updateSidebarCounters();
          } catch (err) {
            alert(`Restore error: ${err.message}`);
          }
        }
      });
    }
  }

  bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        if (e.key === "Escape") document.activeElement.blur();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.getElementById("global-search-input");
        if (searchInput) searchInput.focus();
      } else if (e.key === "Escape") {
        this.articleViewer.close();
        this.toggleNotebookDrawer(false);
      } else if (e.key === "r" || e.key === "R") {
        this.handleRefreshAllFeeds();
      } else if (e.key === "d" || e.key === "D") {
        this.switchView("discovery");
      } else if (e.key === "j") {
        this.navigateEntries(1);
      } else if (e.key === "k") {
        this.navigateEntries(-1);
      } else if (e.key === "s" || e.key === "S") {
        if (this.articleViewer.currentEntry) {
          this.articleViewer.toggleSaved();
        }
      } else if (e.key === "m" || e.key === "M") {
        if (this.articleViewer.currentEntry) {
          this.articleViewer.toggleRead();
        }
      }
    });
  }

  navigateEntries(delta) {
    if (this.currentView === "shorts") {
      const reels = Array.from(document.querySelectorAll(".short-card-reel"));
      if (reels.length === 0) return;
      const container = document.getElementById("shorts-workspace");
      const currentScroll = container.scrollTop;
      const cardHeight = container.clientHeight;
      const currentIndex = Math.round(currentScroll / cardHeight);
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), reels.length - 1);
      reels[nextIndex].scrollIntoView({ behavior: "smooth" });
      return;
    }

    const visibleCards = Array.from(document.querySelectorAll(".card-3d"));
    if (visibleCards.length === 0) return;

    let currentIndex = visibleCards.findIndex((card) => card.dataset.entryId === this.selectedEntryId);
    let nextIndex = currentIndex + delta;

    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= visibleCards.length) nextIndex = visibleCards.length - 1;

    const nextCard = visibleCards[nextIndex];
    if (nextCard) {
      const entryId = nextCard.dataset.entryId;
      const entry = this.entries.find((e) => e.id === entryId);
      if (entry) {
        this.openEntryInReader(entry);
        nextCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  switchView(viewName) {
    this.currentView = viewName;

    // Update navigation items active state
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.view === viewName);
    });

    // Update topbar toggle button
    const toggleShortsBtn = document.getElementById("btn-toggle-shorts");
    if (toggleShortsBtn) {
      toggleShortsBtn.classList.toggle("btn-lime", viewName === "shorts");
      toggleShortsBtn.classList.toggle("btn-outline", viewName !== "shorts");
    }

    const titleMap = {
      timeline: "All Articles",
      queue: "Reading Queue",
      saved: "Saved Offline",
      shorts: "Reels / Shorts Feed",
      notes: "Reading Notes Journal",
      discovery: "Community Discovery",
      settings: "Settings & Backup"
    };
    document.getElementById("workspace-view-title").textContent = titleMap[viewName] || "Timeline";

    // Panel Visibility Management
    const timelinePane = document.getElementById("timeline-pane");
    const shortsWorkspace = document.getElementById("shorts-workspace");
    const notesWorkspace = document.getElementById("notes-journal-workspace");
    const discoveryWorkspace = document.getElementById("discovery-workspace");
    const settingsWorkspace = document.getElementById("settings-workspace");

    timelinePane.style.display = "none";
    shortsWorkspace.style.display = "none";
    notesWorkspace.style.display = "none";
    discoveryWorkspace.style.display = "none";
    if (settingsWorkspace) settingsWorkspace.style.display = "none";

    if (viewName === "shorts") {
      shortsWorkspace.style.display = "flex";
      this.articleViewer.close();
      this.renderShortsFeed();
    } else if (viewName === "notes") {
      notesWorkspace.style.display = "flex";
      this.articleViewer.close();
      this.renderNotesJournal();
    } else if (viewName === "discovery") {
      discoveryWorkspace.style.display = "flex";
      this.initDiscoveryView();
    } else if (viewName === "settings") {
      if (settingsWorkspace) settingsWorkspace.style.display = "flex";
      this.renderSettingsView();
    } else {
      timelinePane.style.display = "flex";
      this.renderCurrentView();
    }
  }

  getFilteredEntries() {
    let filtered = [...this.entries];

    if (this.currentView === "queue") {
      filtered = filtered.filter((e) => {
        const state = this.readingStates.get(e.id);
        return !state || !state.isRead;
      });
    } else if (this.currentView === "saved") {
      filtered = filtered.filter((e) => {
        const state = this.readingStates.get(e.id);
        return state && state.isSaved;
      });
    }

    // Apply Live Search Query across Headlines, Writers/Authors, and Publication Titles
    if (this.searchQuery) {
      const q = this.searchQuery;
      filtered = filtered.filter((e) => {
        const titleMatch = (e.title || "").toLowerCase().includes(q);
        const authorMatch = (e.author || "").toLowerCase().includes(q);
        const subTitle = this.getSubscriptionTitle(e.subscriptionId).toLowerCase();
        const subMatch = subTitle.includes(q);
        const excerptMatch = (e.feedSummaryHtml || "").toLowerCase().includes(q);
        return titleMatch || authorMatch || subMatch || excerptMatch;
      });
    }

    // Sort: newest first
    filtered.sort((a, b) => {
      const dateA = a.publicationDate || a.firstSeenTimestamp;
      const dateB = b.publicationDate || b.firstSeenTimestamp;
      return dateB - dateA;
    });

    return filtered;
  }

  async renderCurrentView() {
    if (this.currentView === "shorts") {
      this.renderShortsFeed();
      return;
    }
    if (this.currentView === "notes") {
      this.renderNotesJournal();
      return;
    }

    const container = document.getElementById("timeline-pane");
    const existingShelf = document.getElementById("recommended-subscriptions-shelf");
    
    // Clear timeline entries without destroying the shelf
    const cards = container.querySelectorAll(".card-3d, .empty-placeholder");
    cards.forEach((c) => c.remove());

    const filtered = this.getFilteredEntries();

    if (filtered.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty-placeholder";
      emptyEl.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px; opacity:0.6;">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p style="font-size:16px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">No articles match your search or filter</p>
          <p style="font-size:13px;">Try searching by writer name, publication, or refresh your feeds.</p>
        </div>
      `;
      container.appendChild(emptyEl);
      return;
    }

    for (const entry of filtered) {
      const state = this.readingStates.get(entry.id);
      const isRead = state ? state.isRead : false;
      const isSaved = state ? state.isSaved : false;

      // Get persistent Views & Likes counts
      const engagement = await getArticleEngagement(entry.id);

      const card = document.createElement("div");
      card.className = `card-3d ${isRead ? 'read' : ''} ${this.selectedEntryId === entry.id ? 'active-reading' : ''}`;
      card.dataset.entryId = entry.id;

      const dateStr = entry.publicationDate
        ? new Date(entry.publicationDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "Undated";

      const subTitle = this.getSubscriptionTitle(entry.subscriptionId);

      card.innerHTML = `
        <div class="card-header">
          <span class="card-source">
            <span style="width:6px; height:6px; border-radius:50%; background:var(--electric-cobalt-light);"></span>
            ${subTitle}
            ${entry.author ? `<span style="color:var(--text-muted);">• By ${entry.author}</span>` : ''}
          </span>
          <span class="card-date">${dateStr}</span>
        </div>
        <h3 class="card-title">${entry.title}</h3>
        <p class="card-excerpt">${this.stripHtml(entry.feedSummaryHtml)}</p>
        <div class="card-footer">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="pill ${isSaved ? 'pill-saved-full' : 'pill-offline-unavailable'}" style="font-size:10px;">
              ${isSaved ? 'Saved Offline' : 'Summary'}
            </span>
            <!-- Views Count Pill -->
            <span class="pill pill-offline-unavailable" style="font-size:10px; gap:4px;" title="Total views">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              ${engagement.viewsCount}
            </span>
          </div>
          <div class="card-actions">
            <!-- Interactive Like Button with Likes Count -->
            <button class="action-icon-btn ${engagement.isLiked ? 'active' : ''}" data-action="like" title="Like article" style="display:flex; align-items:center; gap:4px; font-size:11px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${engagement.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              <span class="likes-tally">${engagement.likesCount}</span>
            </button>

            <!-- Save Bookmark Button -->
            <button class="action-icon-btn ${isSaved ? 'active' : ''}" data-action="save" title="Save offline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>

            <!-- Mark Read Button -->
            <button class="action-icon-btn ${isRead ? 'active' : ''}" data-action="read" title="Mark read/unread">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                ${isRead ? '<path d="M9 12l2 2 4-4"/>' : ''}
              </svg>
            </button>
          </div>
        </div>
      `;

      // Tactile 3D Tilt on card
      setupCard3dTilt(card);

      // Card Click -> Open Reader
      card.addEventListener("click", (e) => {
        if (e.target.closest(".action-icon-btn")) return;
        this.openEntryInReader(entry, subTitle);
      });

      // Like Button Event
      const likeBtn = card.querySelector('[data-action="like"]');
      likeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const updated = await toggleArticleLike(entry.id);
        const tallyEl = card.querySelector(".likes-tally");
        if (tallyEl) tallyEl.textContent = `${updated.likesCount}`;
        likeBtn.classList.toggle("active", updated.isLiked);
        const svg = likeBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", updated.isLiked ? "currentColor" : "none");
        await this.refreshReadingStates();
      });

      // Save Button Event
      const saveBtn = card.querySelector('[data-action="save"]');
      saveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await setReadingState(entry.id, { isSaved: !isSaved });
        await this.refreshReadingStates();
        this.renderCurrentView();
        this.updateSidebarCounters();
      });

      // Read Button Event
      const readBtn = card.querySelector('[data-action="read"]');
      readBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await setReadingState(entry.id, { isRead: !isRead });
        await this.refreshReadingStates();
        this.renderCurrentView();
        this.updateSidebarCounters();
      });

      container.appendChild(card);
    }
  }

  // --- Instagram Reels / YouTube Shorts Fullscreen Vertical Snapping Mode ---
  async renderShortsFeed() {
    const container = document.getElementById("shorts-workspace");
    container.innerHTML = "";

    const entries = this.getFilteredEntries();
    if (entries.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:100px 20px; color:var(--text-muted);">
          <p style="font-size:18px; font-weight:700; color:#FFFFFF;">No articles in Shorts feed.</p>
          <p style="font-size:13px; margin-top:6px;">Add more subscriptions or clear your search query.</p>
        </div>
      `;
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const subTitle = this.getSubscriptionTitle(entry.subscriptionId);
      const state = this.readingStates.get(entry.id);
      const isSaved = state ? state.isSaved : false;
      const engagement = await getArticleEngagement(entry.id);

      const reelCard = document.createElement("div");
      reelCard.className = "short-card-reel";
      reelCard.dataset.entryId = entry.id;

      reelCard.innerHTML = `
        <div class="short-inner-box">
          <div class="short-author-badge">
            <div style="width:34px; height:34px; border-radius:50%; background:var(--electric-cobalt); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px; color:#FFFFFF;">
              ${(entry.author || subTitle).charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:700; color:#FFFFFF; font-size:14px;">${subTitle}</div>
              <div style="font-size:11px; color:var(--acid-lime);">${entry.author ? `Writer: ${entry.author}` : 'Syndicated Feed'}</div>
            </div>
          </div>

          <div class="short-text-area">
            <h2 class="short-title">${entry.title}</h2>
            <div class="short-content-body">
              ${entry.feedSummaryHtml}
            </div>
          </div>

          <!-- Bottom: Similar Headlines -->
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--midnight-border); font-size:12px; color:var(--text-secondary); display:flex; justify-content:space-between; align-items:center;">
            <span>Swipe or Scroll down for next story ↓</span>
            <span style="font-family:var(--font-mono); color:var(--text-dim);">${i + 1} of ${entries.length}</span>
          </div>

          <!-- Floating Right Action Rail (Reels / Shorts Style) -->
          <div class="short-action-rail">
            <!-- Like Button -->
            <div>
              <button class="short-rail-btn ${engagement.isLiked ? 'active' : ''}" data-reel-like title="Like">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="${engagement.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
              <div class="short-rail-label reel-likes-tally">${engagement.likesCount}</div>
            </div>

            <!-- Views Badge -->
            <div>
              <div class="short-rail-btn" style="cursor:default;" title="Views">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <div class="short-rail-label">${engagement.viewsCount}</div>
            </div>

            <!-- Save Bookmark Button -->
            <div>
              <button class="short-rail-btn ${isSaved ? 'active' : ''}" data-reel-save title="Save Offline">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
              <div class="short-rail-label">${isSaved ? 'Saved' : 'Save'}</div>
            </div>

            <!-- Expand Full Article -->
            <div>
              <button class="short-rail-btn" data-reel-expand title="Read in Full Reader">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
              <div class="short-rail-label">Read</div>
            </div>
          </div>
        </div>
      `;

      // Like Action in Reel
      const reelLikeBtn = reelCard.querySelector("[data-reel-like]");
      reelLikeBtn.addEventListener("click", async () => {
        const updated = await toggleArticleLike(entry.id);
        reelLikeBtn.classList.toggle("active", updated.isLiked);
        const svg = reelLikeBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", updated.isLiked ? "currentColor" : "none");
        reelCard.querySelector(".reel-likes-tally").textContent = `${updated.likesCount}`;
        await this.refreshReadingStates();
      });

      // Save Action in Reel
      const reelSaveBtn = reelCard.querySelector("[data-reel-save]");
      reelSaveBtn.addEventListener("click", async () => {
        const cur = await setReadingState(entry.id, { isSaved: !isSaved });
        reelSaveBtn.classList.toggle("active", cur.isSaved);
        await this.refreshReadingStates();
        this.updateSidebarCounters();
      });

      // Expand to Full Reader
      reelCard.querySelector("[data-reel-expand]").addEventListener("click", () => {
        this.openEntryInReader(entry, subTitle);
      });

      container.appendChild(reelCard);
    }

    // IntersectionObserver to record view & mark read on scroll snap
    const observer = new IntersectionObserver((entriesObs) => {
      entriesObs.forEach((entryObs) => {
        if (entryObs.isIntersecting) {
          const entryId = entryObs.target.dataset.entryId;
          recordArticleView(entryId);
          setReadingState(entryId, { isRead: true });
        }
      });
    }, { threshold: 0.6 });

    container.querySelectorAll(".short-card-reel").forEach((el) => observer.observe(el));
  }

  // --- Recommended Subscriptions Shelf ---
  async renderRecommendedShelf() {
    const shelf = document.getElementById("recommended-subscriptions-shelf");
    if (!shelf) return;

    try {
      const userFeeds = this.subscriptions.map((s) => s.resolvedFeedUrl).join(",");
      const res = await fetch(`/api/discovery/recommendations?mode=related&userFeeds=${encodeURIComponent(userFeeds)}`);
      if (!res.ok) return;

      const data = await res.json();
      const recs = (data.recommendations || []).slice(0, 4);

      if (recs.length === 0) {
        shelf.style.display = "none";
        return;
      }

      shelf.style.display = "block";
      shelf.innerHTML = `
        <div class="shelf-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--acid-lime)" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <h3 style="font-size:14px; font-weight:800; color:#FFFFFF;">Recommended Subscriptions for You</h3>
          </div>
          <span style="font-size:11px; font-family:var(--font-mono); color:var(--text-muted);">Co-subscription Overlap</span>
        </div>
        <div class="shelf-cards-row" id="shelf-cards-container"></div>
      `;

      const shelfCards = shelf.querySelector("#shelf-cards-container");
      recs.forEach((rec) => {
        const card = document.createElement("div");
        card.className = "shelf-sub-card";
        card.innerHTML = `
          <div>
            <div style="font-size:13px; font-weight:700; color:#FFFFFF; margin-bottom:4px;">${rec.title || rec.feed_url}</div>
            <div style="font-size:11px; color:var(--text-secondary); line-height:1.4;">${rec.explanation}</div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span style="font-size:10px; font-family:var(--font-mono); color:var(--acid-lime);">${rec.accepted_batch_count} batches</span>
            <button class="btn btn-lime" style="padding:3px 10px; font-size:11px;" data-sub-rec-url="${rec.feed_url}">
              + Subscribe
            </button>
          </div>
        `;

        card.querySelector(`[data-sub-rec-url="${rec.feed_url}"]`).addEventListener("click", async () => {
          await this.subscribeToUrl(rec.feed_url, rec.title);
          this.renderRecommendedShelf();
        });

        shelfCards.appendChild(card);
      });
    } catch (_) {
      shelf.style.display = "none";
    }
  }

  // --- Reading Notes Journal Workspace ---
  async renderNotesJournal() {
    const grid = document.getElementById("notes-journal-grid");
    if (!grid) return;
    grid.innerHTML = "<p style='color:var(--text-muted);'>Loading your notes...</p>";

    const notes = await getAllNotes();
    this.updateSidebarCounters(notes.length);

    grid.innerHTML = "";
    if (notes.length === 0) {
      grid.innerHTML = `
        <div style="text-align:center; padding:60px 20px; grid-column:1/-1; color:var(--text-muted);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px; opacity:0.6;">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <p style="font-size:16px; font-weight:600; color:#FFFFFF;">No reading notes yet</p>
          <p style="font-size:13px; margin-top:4px;">Highlight text in any article and click "Quote Selected Text", or write your thoughts directly in the reader.</p>
        </div>
      `;
      return;
    }

    notes.sort((a, b) => b.timestamp - a.timestamp);
    notes.forEach((note) => {
      const card = document.createElement("div");
      card.className = "card-3d";
      setupCard3dTilt(card);

      const timeStr = new Date(note.timestamp).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
      });

      card.innerHTML = `
        <div class="card-header">
          <span style="font-size:11px; font-family:var(--font-mono); color:var(--electric-cobalt-light);">${timeStr}</span>
          <button class="btn btn-danger" style="padding:2px 8px; font-size:11px;" data-del-note="${note.id}">Delete</button>
        </div>
        <h4 style="font-size:15px; font-weight:700; color:#FFFFFF; margin-bottom:8px; cursor:pointer;" data-open-note-article>
          ${note.articleTitle || 'Untitled Article'}
        </h4>
        ${note.quoteText ? `<blockquote style="border-left:3px solid var(--acid-lime); padding-left:10px; margin-bottom:10px; font-size:13px; color:var(--acid-lime); font-style:italic; background:rgba(212,255,38,0.05); padding:8px 12px; border-radius:4px;">“${note.quoteText}”</blockquote>` : ''}
        ${note.noteText ? `<p style="font-size:13px; color:var(--text-primary); line-height:1.5;">${note.noteText}</p>` : ''}
      `;

      card.querySelector(`[data-del-note="${note.id}"]`).addEventListener("click", async () => {
        await deleteNote(note.id);
        this.renderNotesJournal();
      });

      card.querySelector("[data-open-note-article]").addEventListener("click", () => {
        const entry = this.entries.find((e) => e.id === note.entryId);
        if (entry) {
          this.switchView("timeline");
          this.openEntryInReader(entry);
        }
      });

      grid.appendChild(card);
    });
  }

  async exportNotesAsMarkdown() {
    const notes = await getAllNotes();
    if (notes.length === 0) {
      alert("No notes to export.");
      return;
    }

    let md = `# Commonplace Reading Notes & Annotations\nExported on: ${new Date().toLocaleString()}\n\n---\n\n`;
    notes.forEach((n, idx) => {
      md += `### ${idx + 1}. ${n.articleTitle || 'Untitled'}\n`;
      if (n.author) md += `*Author:* ${n.author}\n`;
      md += `*Source:* [${n.articleUrl}](${n.articleUrl})\n`;
      md += `*Date:* ${new Date(n.timestamp).toLocaleString()}\n\n`;
      if (n.quoteText) md += `> ${n.quoteText}\n\n`;
      if (n.noteText) md += `**Note:** ${n.noteText}\n\n`;
      md += `---\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commonplace-notes-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  openEntryInReader(entry, subTitle = "") {
    this.selectedEntryId = entry.id;
    document.querySelectorAll(".card-3d").forEach((c) => {
      c.classList.toggle("active-reading", c.dataset.entryId === entry.id);
    });
    const title = subTitle || this.getSubscriptionTitle(entry.subscriptionId);
    this.articleViewer.loadArticle(entry, title, this.entries);
  }

  stripHtml(html) {
    if (!html) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  async updateSidebarCounters(notesCount = null) {
    const totalCount = this.entries.length;
    let unreadCount = 0;
    let savedCount = 0;

    this.entries.forEach((e) => {
      const state = this.readingStates.get(e.id);
      if (!state || !state.isRead) unreadCount++;
      if (state && state.isSaved) savedCount++;
    });

    const elTotal = document.getElementById("counter-all");
    const elUnread = document.getElementById("counter-queue");
    const elSaved = document.getElementById("counter-saved");
    const elNotes = document.getElementById("counter-notes");

    if (elTotal) elTotal.textContent = totalCount;
    if (elUnread) elUnread.textContent = unreadCount;
    if (elSaved) elSaved.textContent = savedCount;

    if (elNotes) {
      if (notesCount !== null) {
        elNotes.textContent = notesCount;
      } else {
        const notes = await getAllNotes();
        elNotes.textContent = notes.length;
      }
    }
  }

  // --- Bounded Refresh Worker Queue Execution ---
  async handleRefreshAllFeeds() {
    const refreshBtn = document.getElementById("btn-refresh-all");
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";

    const startTime = Date.now();

    await refreshAllSubscriptions(this.subscriptions, async (sub, status, result) => {
      const latency = Date.now() - startTime;
      if (status === "success") {
        this.feedDiagnostics.set(sub.id, {
          title: sub.title,
          url: sub.resolvedFeedUrl,
          status: "healthy",
          httpCode: 200,
          latency: `${latency}ms`,
          lastSuccess: Date.now(),
          errorMsg: null
        });

        if (result.entries && result.entries.length > 0) {
          await putEntries(result.entries);
        }

        sub.lastSuccessTimestamp = Date.now();
        sub.refreshStatus = "idle";
        await putSubscription(sub);
      } else {
        this.feedDiagnostics.set(sub.id, {
          title: sub.title,
          url: sub.resolvedFeedUrl,
          status: "failed",
          httpCode: "Error",
          latency: `${latency}ms`,
          lastSuccess: sub.lastSuccessTimestamp || null,
          errorMsg: result
        });

        sub.refreshStatus = "error";
        sub.failureDetails = {
          code: "REFRESH_ERROR",
          message: result,
          retryEligible: true
        };
        await putSubscription(sub);
      }
    });

    this.entries = await getAllEntries();
    await this.refreshReadingStates();
    this.renderCurrentView();
    this.renderRecommendedShelf();
    this.updateSidebarCounters();
    this.renderRefreshNotebook();

    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh All";
  }

  toggleNotebookDrawer(open) {
    const drawer = document.getElementById("refresh-notebook-drawer");
    if (drawer) {
      drawer.classList.toggle("open", open);
      if (open) this.renderRefreshNotebook();
    }
  }

  renderRefreshNotebook() {
    const body = document.getElementById("notebook-content-body");
    if (!body) return;

    body.innerHTML = "";
    if (this.subscriptions.length === 0) {
      body.innerHTML = "<p style='color:var(--text-muted);'>No feeds subscribed.</p>";
      return;
    }

    this.subscriptions.forEach((sub) => {
      const diag = this.feedDiagnostics.get(sub.id) || {
        status: sub.refreshStatus === 'error' ? 'failed' : 'idle',
        httpCode: sub.refreshStatus === 'error' ? 'Failed' : '200 OK',
        latency: 'N/A',
        lastSuccess: sub.lastSuccessTimestamp || null,
        errorMsg: sub.failureDetails ? sub.failureDetails.message : null
      };

      const card = document.createElement("div");
      card.className = "feed-diagnostic-card";

      const isHealthy = diag.status !== 'failed';
      const lastSuccessStr = diag.lastSuccess
        ? new Date(diag.lastSuccess).toLocaleTimeString()
        : "Never";

      card.innerHTML = `
        <div class="diagnostic-status-bar">
          <span style="font-weight:700; color:#FFFFFF;">${sub.title}</span>
          <span class="pill ${isHealthy ? 'pill-saved-full' : 'pill-offline'}">
            ${isHealthy ? 'Healthy' : 'Failure'}
          </span>
        </div>
        <div style="font-size:11px; font-family:var(--font-mono); color:var(--text-dim); word-break:break-all;">
          ${sub.resolvedFeedUrl}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-secondary); margin-top:4px;">
          <span>Last Success: ${lastSuccessStr}</span>
          <span>Latency: ${diag.latency}</span>
        </div>
        ${diag.errorMsg ? `<div style="font-size:11px; color:var(--color-error); background:rgba(255,71,87,0.1); padding:6px; border-radius:4px; margin-top:4px;">${diag.errorMsg}</div>` : ''}
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
          <button class="btn btn-outline" style="padding:4px 8px; font-size:11px;" data-retry-sub="${sub.id}">
            Retry Feed
          </button>
          <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" data-delete-sub="${sub.id}">
            Remove
          </button>
        </div>
      `;

      card.querySelector(`[data-retry-sub="${sub.id}"]`).addEventListener("click", async () => {
        try {
          const feedData = await fetchSingleFeedWithIsolation(sub);
          if (feedData.entries) await putEntries(feedData.entries);
          sub.lastSuccessTimestamp = Date.now();
          sub.refreshStatus = "idle";
          await putSubscription(sub);
          await this.loadPersistedData();
          this.renderCurrentView();
          this.renderRefreshNotebook();
        } catch (err) {
          alert(`Retry failed: ${err.message}`);
        }
      });

      card.querySelector(`[data-delete-sub="${sub.id}"]`).addEventListener("click", async () => {
        if (confirm(`Remove subscription "${sub.title}"?`)) {
          await deleteSubscription(sub.id);
          await this.loadPersistedData();
          this.renderCurrentView();
          this.updateSidebarCounters();
          this.renderRefreshNotebook();
        }
      });

      body.appendChild(card);
    });
  }

  // --- Add Feed Modal with Autodiscovery & 1-Click Curated Blogs ---
  showAddFeedModal() {
    const existing = document.getElementById("add-feed-modal-backdrop");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "add-feed-modal-backdrop";
    backdrop.className = "modal-backdrop";

    backdrop.innerHTML = `
      <div class="modal-window" style="width:640px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h2 class="modal-title" style="margin-bottom:2px;">Subscribe to Any Blog</h2>
            <p style="font-size:12px; color:var(--text-secondary);">Enter any blog or website URL — our autodiscovery engine detects feeds automatically.</p>
          </div>
          <button id="add-modal-close-x" class="btn btn-outline" style="padding:4px 8px;">✕</button>
        </div>

        <!-- Direct URL input -->
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input type="url" id="modal-feed-url-input" class="search-input" style="padding-left:14px; font-size:14px;" placeholder="e.g. overreacted.io, github.blog, or rss link..." />
          <button id="modal-subscribe-btn" class="btn btn-lime" style="white-space:nowrap; padding:8px 18px;">
            Subscribe
          </button>
        </div>
        <div id="modal-autodiscover-status" style="font-size:12px; min-height:18px; margin-bottom:20px; color:var(--text-dim);"></div>

        <div style="border-top:1px solid var(--midnight-border); padding-top:16px;">
          <div style="font-size:12px; font-weight:700; color:var(--acid-lime); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">
            Curated 1-Click Popular Blogs
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:260px; overflow-y:auto; padding-right:6px;" id="curated-blogs-list"></div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("#add-modal-close-x").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    const input = backdrop.querySelector("#modal-feed-url-input");
    const statusEl = backdrop.querySelector("#modal-autodiscover-status");
    const subBtn = backdrop.querySelector("#modal-subscribe-btn");

    // Populate Curated Blogs List
    const curatedContainer = backdrop.querySelector("#curated-blogs-list");
    CURATED_POPULAR_BLOGS.forEach((blog) => {
      const isAlreadySubbed = this.subscriptions.some((s) => s.resolvedFeedUrl === blog.url);
      const card = document.createElement("div");
      card.style.background = "var(--midnight-card)";
      card.style.border = "1px solid var(--midnight-border)";
      card.style.borderRadius = "8px";
      card.style.padding = "10px 12px";
      card.style.display = "flex";
      card.style.justifyContent = "space-between";
      card.style.alignItems = "center";
      card.style.gap = "8px";

      card.innerHTML = `
        <div style="overflow:hidden;">
          <div style="font-size:13px; font-weight:700; color:#FFFFFF; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${blog.title}</div>
          <div style="font-size:11px; color:var(--text-muted);">${blog.author} • <span style="color:var(--electric-cobalt-light);">${blog.category}</span></div>
        </div>
        <button class="btn ${isAlreadySubbed ? 'btn-outline' : 'btn-lime'}" style="padding:3px 8px; font-size:11px; white-space:nowrap;" ${isAlreadySubbed ? 'disabled' : ''}>
          ${isAlreadySubbed ? 'Subscribed' : '+ Add'}
        </button>
      `;

      if (!isAlreadySubbed) {
        card.querySelector("button").addEventListener("click", async () => {
          close();
          await this.subscribeToUrl(blog.url, blog.title);
        });
      }

      curatedContainer.appendChild(card);
    });

    // Enter key submits URL
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") subBtn.click();
    });

    subBtn.addEventListener("click", async () => {
      const url = input.value.trim();
      if (!url) return;

      statusEl.innerHTML = `<span style="color:var(--acid-lime);">Detecting & verifying feed...</span>`;
      subBtn.disabled = true;

      try {
        await this.subscribeToUrl(url);
        close();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--color-error);">${err.message}</span>`;
        subBtn.disabled = false;
      }
    });

    input.focus();
  }

  async subscribeToUrl(url, optionalTitle = "") {
    // 1. Run intelligent autodiscovery
    const discovery = await resolveAndDiscoverFeed(url);
    const feedUrl = discovery.resolvedFeedUrl;
    const title = discovery.suggestedTitle || optionalTitle || feedUrl;
    const siteUrl = discovery.siteUrl || feedUrl;

    const id = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    const newSub = {
      id,
      enteredUrl: url,
      resolvedFeedUrl: feedUrl,
      siteUrl,
      title,
      refreshStatus: "pending"
    };

    // 2. Fetch and parse feed entries safely
    const feedData = await fetchSingleFeedWithIsolation(newSub);
    newSub.title = feedData.title || title;
    newSub.siteUrl = feedData.siteUrl || siteUrl;
    newSub.resolvedFeedUrl = feedData.finalUrl || feedUrl;
    newSub.refreshStatus = "idle";
    newSub.lastSuccessTimestamp = Date.now();

    await putSubscription(newSub);
    if (feedData.entries && feedData.entries.length > 0) {
      await putEntries(feedData.entries);
    }

    await this.loadPersistedData();
    this.renderCurrentView();
    this.renderRecommendedShelf();
    this.updateSidebarCounters();

    alert(`Successfully subscribed to "${newSub.title}"!`);
  }

  // --- Discovery Workspace & 3D Cosmos ---
  async initDiscoveryView() {
    const canvasEl = document.getElementById("cosmos-canvas");
    if (!this.cosmos3dInstance && canvasEl) {
      this.cosmos3dInstance = new Cosmos3D(canvasEl, (rec) => {
        showRecommendationReceipt(rec, (url, title) => this.subscribeToUrl(url, title));
      });
    }

    await this.loadDiscoveryRecommendations("related");
  }

  async loadDiscoveryRecommendations(mode = "related") {
    const grid = document.getElementById("discovery-grid");
    grid.innerHTML = "<div style='color:var(--text-muted);'>Loading recommendations...</div>";

    try {
      const userFeeds = this.subscriptions.map((s) => s.resolvedFeedUrl).join(",");
      const res = await fetch(`/api/discovery/recommendations?mode=${mode}&userFeeds=${encodeURIComponent(userFeeds)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const recs = data.recommendations || [];

      if (this.cosmos3dInstance) {
        this.cosmos3dInstance.updateData(recs);
      }

      grid.innerHTML = "";
      if (recs.length === 0) {
        grid.innerHTML = "<div style='color:var(--text-muted); padding:20px;'>No candidate recommendations found matching support thresholds.</div>";
        return;
      }

      recs.forEach((rec) => {
        const card = document.createElement("div");
        card.className = "card-3d";
        setupCard3dTilt(card);

        const isSeeded = rec.is_synthetic;
        card.innerHTML = `
          <div class="card-header">
            <span class="pill ${isSeeded ? 'pill-synthetic' : 'pill-saved-full'}" style="font-size:10px;">
              ${isSeeded ? 'Demo Data' : 'Community Batch'}
            </span>
            <span style="font-size:11px; font-family:var(--font-mono); color:var(--text-muted);">
              ${rec.accepted_batch_count} batches
            </span>
          </div>
          <h4 class="card-title" style="font-size:15px; margin-bottom:6px;">${rec.title || rec.feed_url}</h4>
          <p class="card-excerpt" style="font-size:12px; margin-bottom:12px;">${rec.explanation}</p>
          <div class="card-footer" style="padding-top:8px;">
            <button class="btn btn-outline" style="padding:4px 8px; font-size:11px;" data-view-receipt>
              Inspect Receipt
            </button>
            <button class="btn btn-lime" style="padding:4px 10px; font-size:11px;" data-sub-rec>
              Subscribe
            </button>
          </div>
        `;

        card.querySelector("[data-view-receipt]").addEventListener("click", () => {
          showRecommendationReceipt(rec, (url, title) => this.subscribeToUrl(url, title));
        });

        card.querySelector("[data-sub-rec]").addEventListener("click", () => {
          this.subscribeToUrl(rec.feed_url, rec.title);
        });

        grid.appendChild(card);
      });
    } catch (err) {
      grid.innerHTML = `<div style="color:var(--color-error); padding:20px;">Could not load discovery recommendations: ${err.message}</div>`;
    }
  }

  // --- Explicit Anonymous Batch Sharing ---
  async handleExplicitBatchShare() {
    if (this.subscriptions.length === 0) {
      alert("You have no subscriptions to share.");
      return;
    }

    const feedUrls = this.subscriptions.map((s) => s.resolvedFeedUrl);
    const sortedHash = feedUrls.slice().sort().join("|");

    const lastHash = await getSetting("last_shared_batch_hash");
    if (lastHash === sortedHash) {
      const proceed = confirm(
        "Notice: Your subscription batch has not changed since your last submission.\n\n" +
        "Repeated submissions of unchanged batches are discouraged to preserve discovery integrity.\n\n" +
        "Do you still wish to submit this batch?"
      );
      if (!proceed) return;
    }

    const titles = {};
    this.subscriptions.forEach((s) => {
      titles[s.resolvedFeedUrl] = s.title;
    });

    try {
      const res = await fetch("/api/discovery/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrls, titles })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      await setSetting("last_shared_batch_hash", sortedHash);
      await setSetting("last_shared_timestamp", Date.now());

      alert(
        `Batch Shared Successfully!\n\n` +
        `• Accepted Feeds: ${feedUrls.length}\n` +
        `• Privacy Assurance: Zero IP addresses, client tokens, or individual reading histories were recorded.`
      );

      this.loadDiscoveryRecommendations("related");
    } catch (err) {
      alert(`Sharing failed: ${err.message}`);
    }
  }

  // --- Settings & Diagnostics View ---
  async renderSettingsView() {
    const lastSharedTs = await getSetting("last_shared_timestamp");
    const lastSharedStr = lastSharedTs ? new Date(lastSharedTs).toLocaleString() : "Never";

    const elLastShared = document.getElementById("settings-last-shared-time");
    if (elLastShared) elLastShared.textContent = lastSharedStr;

    try {
      const res = await fetch("/api/discovery/seed-status");
      const status = await res.json();
      const seedEl = document.getElementById("settings-seed-status");
      if (seedEl) {
        seedEl.innerHTML = `
          <strong>Status:</strong> <span class="pill ${status.status === 'BLOCKED' ? 'pill-offline' : 'pill-saved-full'}">${status.status}</span><br/>
          <span style="font-size:12px; color:var(--text-secondary); margin-top:4px; display:block;">${status.reason || 'Audited successfully'}</span>
        `;
      }
    } catch (_) {}
  }
}

// Bootstrap application on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new CommonplaceApp();
});
