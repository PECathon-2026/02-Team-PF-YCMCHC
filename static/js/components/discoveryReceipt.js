/**
 * Recommendation Receipt Modal Component (discoveryReceipt.js)
 * Implements:
 * - Transparent explanation of recommendation basis
 * - Explicit distinction between seeded demo data and submitted community batches
 * - Clear disclosure of anonymous counting limitations
 */

export function showRecommendationReceipt(rec, onSubscribe) {
  // Remove existing modal if any
  const existing = document.getElementById("receipt-modal-backdrop");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "receipt-modal-backdrop";
  backdrop.className = "modal-backdrop";

  const isSynthetic = rec.is_synthetic || false;
  const batchCount = rec.accepted_batch_count || 0;

  backdrop.innerHTML = `
    <div class="modal-window">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <span class="pill ${isSynthetic ? 'pill-synthetic' : 'pill-saved-full'}">
          ${isSynthetic ? 'Demo Data (Seeded)' : 'Organic Community Evidence'}
        </span>
        <button id="modal-close-x" class="btn btn-outline" style="padding:4px 8px;">✕</button>
      </div>

      <h2 class="modal-title" style="margin-bottom:6px;">${rec.title || rec.feed_url}</h2>
      <div style="font-family:var(--font-mono); font-size:12px; color:var(--text-muted); word-break:break-all; margin-bottom:18px;">
        ${rec.feed_url}
      </div>

      <div style="background:var(--midnight-card); border:1px solid var(--midnight-border); border-radius:8px; padding:16px; margin-bottom:20px;">
        <div style="font-size:12px; font-weight:700; color:var(--acid-lime); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">
          Recommendation Basis
        </div>
        <div style="font-size:14px; color:#FFFFFF; margin-bottom:12px; line-height:1.4;">
          ${rec.explanation}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; padding-top:12px; border-top:1px solid var(--midnight-border-subtle); font-size:12px;">
          <div>
            <span style="color:var(--text-dim); display:block;">Accepted Batches</span>
            <span style="font-size:16px; font-weight:700; color:var(--text-primary); font-family:var(--font-mono);">
              ${batchCount}
            </span>
          </div>
          <div>
            <span style="color:var(--text-dim); display:block;">Ranking Score</span>
            <span style="font-size:16px; font-weight:700; color:var(--electric-cobalt-light); font-family:var(--font-mono);">
              ${rec.score ? rec.score.toFixed(3) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      <div style="font-size:12px; color:var(--text-secondary); line-height:1.5; margin-bottom:24px; border-left:2px solid var(--electric-cobalt); padding-left:12px;">
        <strong>Counting Semantics:</strong> This counter measures accepted anonymous submission batches containing this feed. Without accounts or device fingerprints, it does not represent verified unique individual readers.
      </div>

      <div class="modal-footer">
        <button id="modal-cancel-btn" class="btn btn-outline">Close</button>
        <button id="modal-subscribe-btn" class="btn btn-lime">
          Subscribe to Feed
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Event handlers
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-x").addEventListener("click", close);
  backdrop.querySelector("#modal-cancel-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.querySelector("#modal-subscribe-btn").addEventListener("click", () => {
    close();
    if (onSubscribe) onSubscribe(rec.feed_url, rec.title);
  });
}
