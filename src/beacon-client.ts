import { ValidatorResponse, StoredState , Status } from "./types";

const BEACON_API_VERSION = "eth/v1";
const STATE_ID = "head";
const PARAM_DELIMITER = "&";
const STATUS_PARAM = "status";
const ID_PARAM = "id";

interface FetchedValidators {
  [pubkey: string]: {
    status: Status;
    activation_epoch: number;
  };
}

export async function fetchValidators(
  baseUrl: string,
  pubkeys: string[]
): Promise<ValidatorResponse> {
  if (pubkeys.length === 0) {
    throw new Error("No pubkeys provided for fetch");
  }

  const queryParams: string[] = [];
  const uniquePubkeys = [...new Set(pubkeys)];

  queryParams.push(`${STATUS_PARAM}=active_ongoing,active_exiting,active_slashed,exited_unslashed,exited_slashed,withdrawal_possible,withdrawal_done,pending_initialized,pending_queued`);
  uniquePubkeys.forEach((pubkey) => {
    queryParams.push(`${ID_PARAM}=${pubkey}`);
  });

  const queryString = queryParams.join(PARAM_DELIMITER);
  const url = `${baseUrl}/${BEACON_API_VERSION}/beacon/states/${STATE_ID}/validators?${queryString}`;

  console.log(`🔍 Fetching validators. Request url: ${url}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as ValidatorResponse;
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch validators: ${message}`);
  }
}

export function findActivatedValidators(
  storedState: StoredState,
  fetchedValidators: FetchedValidators
): { pubkey: string; activation_epoch: number }[] {
  const activations: { pubkey: string; activation_epoch: number }[] = [];

  for (const [pubkey, newStatus] of Object.entries(fetchedValidators)) {
    const oldStatus = storedState[pubkey];

    if (oldStatus && oldStatus === "pending_queued" && newStatus.status === "active_ongoing") {
      activations.push({
        pubkey,
        activation_epoch: newStatus.activation_epoch,
      });
    }
  }

  return activations;
}
