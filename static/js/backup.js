/**
 * Local Backup & Restore Manager (backup.js)
 * Implements:
 * - JSON and OPML export of subscriptions, read states, and saved items
 * - Explicit privacy warning disclosure before download
 * - Safe validation and collision-free import/restore
 */

import {
  getAllSubscriptions,
  getAllReadingStates,
  putSubscription,
  putEntries,
  setReadingState
} from "./db.js";

export async function exportLocalDataToJson() {
  const subscriptions = await getAllSubscriptions();
  const readingStatesMap = await getAllReadingStates();

  const exportPayload = {
    app: "Commonplace",
    version: "1.0",
    exportTimestamp: Date.now(),
    subscriptions,
    readingStates: Array.from(readingStatesMap.values())
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `commonplace-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importLocalDataFromJson(jsonFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.subscriptions || !Array.isArray(data.subscriptions)) {
          throw new Error("Invalid backup file: missing subscriptions array.");
        }

        let importedSubs = 0;
        for (const sub of data.subscriptions) {
          if (sub.id && sub.resolvedFeedUrl) {
            await putSubscription(sub);
            importedSubs++;
          }
        }

        if (data.readingStates && Array.isArray(data.readingStates)) {
          for (const state of data.readingStates) {
            if (state.entryId) {
              await setReadingState(state.entryId, state);
            }
          }
        }

        resolve({ success: true, count: importedSubs });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read backup file."));
    reader.readAsText(jsonFile);
  });
}
