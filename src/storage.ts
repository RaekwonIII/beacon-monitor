import { ValidatorResponse, StoredState, Status } from "./types";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_FILE = path.join(__dirname, "..", "validators.json");

export async function loadValidatorStatuses(): Promise<StoredState> {
  try {
    const fileExists = Bun.file(STORAGE_FILE).exists();
    if (!fileExists) {
      return {};
    }

    const content = await Bun.file(STORAGE_FILE).text();
    const data = JSON.parse(content) as StoredState;

    return data || {};
  } catch (error) {
    console.error("Failed to read validators.json:", error);
    return {};
  }
}

export function saveValidatorStatuses(statuses: StoredState): void {
  try {
    const jsonString = JSON.stringify(statuses, null, 2);
    Bun.write(STORAGE_FILE, jsonString);
    console.log("💾 Saved validator statuses to validators.json");
  } catch (error) {
    throw new Error(`Failed to write validators.json: ${error}`);
  }
}

export function processFetchedValidators(
  response: ValidatorResponse,
  storedState: StoredState
): StoredState {
  if (!response.data || !Array.isArray(response.data)) {
    console.warn("⚠️  No valid validator data in response");
    return storedState;
  }

  const newFetchedState: StoredState = { ...storedState };

  for (const item of response.data) {
    if (!item.validator || !item.validator.pubkey) {
      continue;
    }

    const pubkey = item.validator.pubkey;
    const newStatus = item.status;
    const activationEpoch = parseInt(item.validator.activation_epoch || "0");

    newFetchedState[pubkey] = newStatus;

    if (newStatus === "active_ongoing") {
      console.log(`✅ Activated: pubkey: ${pubkey}, activation_epoch: ${activationEpoch}`);
    }
  }

  return newFetchedState;
}

export function filterPendingOnly(storedState: StoredState): string[] {

  return Object.entries(storedState).filter(([_, status]) => status !== "active_ongoing").map(([pubkey, status]) => pubkey)
}
