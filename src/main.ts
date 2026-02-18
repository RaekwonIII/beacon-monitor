#!/usr/bin/env bun

import {
  loadValidatorStatuses,
  saveValidatorStatuses,
  processFetchedValidators,
  filterPendingOnly,
} from "./storage";
import { findEnvVariable, initializeSSV } from "./utils";
import { fetchValidators } from "./beacon-client";
import path from "path";
import { fileURLToPath } from "url";
import { KeyShareMapping, KeyShareObj } from "./types";
import { KeySharesPayload } from "@ssv-labs/ssv-sdk/dist/libs/ssv-keys/KeyShares/KeySharesData/KeySharesPayload";

const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
const EPOCH_LENGHT_MILLISECONDS = 32 * 12 * 1000;


function nextEpochTime(): string {
  const now = new Date();
  const nextEpoch = new Date(now.getTime() + EPOCH_LENGHT_MILLISECONDS);
  return nextEpoch.toLocaleTimeString();
}

async function loadKeyshares(keysharesFile: string): Promise<KeyShareObj[]> {
  try {
    const fileExists = Bun.file(keysharesFile).exists();
    if (!fileExists) {
      throw new Error("keyshares.json file not found");
    }

    const content = await Bun.file(keysharesFile).text();
    const data = JSON.parse(content);

    return data;
  } catch (error) {
    console.error("Failed to read keyshares.json:", error);
    throw new Error(
      "Failed to load keyshares. Please check keyshares.json exists and is valid.",
    );
  }
}

export async function main(): Promise<void> {
  try {
    const beaconUrl = findEnvVariable(
      process.env.BEACON_NODE_URL,
      "BEACON_NODE_URL",
    );
    const sdk = await initializeSSV();
    const keysharesFile = findEnvVariable(
      process.env.KEYSHARES_FILE,
      "KEYSHARES_FILE",
    );
    const keyshares = await loadKeyshares(keysharesFile);
    const pubkeyToKeyshares = keyshares.reduce<KeyShareMapping>(
      (acc, keyshare) => {
        acc[keyshare.publicKey] = keyshare;
        return acc;
      },
      {},
    );
    let pubkeys = keyshares.map((k) => k.publicKey);

    console.log("📊 beacon-monitor starting...");
    console.log("🔗 Beacon node:", beaconUrl);

    let storedState = await loadValidatorStatuses();

    if (pubkeys.length > 0) {
      console.log(`📋 Initial pubkeys: ${pubkeys.length}`);
      console.log("🔍 Searching for last stored validators state");

      for (const pubkey of pubkeys) {
        if (!storedState.hasOwnProperty(pubkey)) {
          console.log(`✨ Added new validator to monitoring: ${pubkey}`);
          storedState[pubkey] = "pending_queued";
        }
      }

      saveValidatorStatuses(storedState);
    } else {
      console.log("🔍 No pubkeys provided via CLI");
    }

    while (true) {
      try {
        pubkeys = filterPendingOnly(storedState);
        console.log(
          `📈 Total pending validators to monitor: ${pubkeys.length}`,
        );
        console.log("⏱️  Polling for new validator activations...");
        const response = await fetchValidators(beaconUrl, pubkeys);
        storedState = processFetchedValidators(response, storedState);
        saveValidatorStatuses(storedState);

        // Check for newly activated validators and register them
        let keysharesToRegister: KeySharesPayload[] = [];
        for (const [pubkey, status] of Object.entries(storedState)) {
          // verify if any previously pending key has nowe become active
          if (
            status === "active_ongoing" &&
            storedState[pubkey] !== "active_ongoing"
          ) {
            // add these to the set of validators that need to be registered
            const keysharesPayload = pubkeyToKeyshares[pubkey];
            if (!keysharesPayload) {
              console.log(`⚠️  No keyshares found for pubkey: ${pubkey}`);
              continue;
            }
            keysharesToRegister.push(keysharesPayload as KeySharesPayload);
          }
        }

        // if there's any validators that need to be registered
        if (keysharesToRegister.length > 0) {
          console.log(
            `✅ Found ${keysharesToRegister.length} activated validators to register`,
          );

          try {
            console.log(
              `🔄 Registering ${keysharesToRegister.length} validators with SSV network...`,
            );

            // Register the validators in bulk
            const txnReceipt = await sdk.clusters
              .registerValidators({
                args: {
                  keyshares: keysharesToRegister,
                  depositAmount: 100000n, // Placeholder - actual deposit amount should be set based on requirements
                },
              })
              .then((tx) => tx.wait());

            console.log(
              `✅ Successfully registered validators, tx hash: ${txnReceipt.transactionHash}`,
            );
          } catch (regError) {
            console.error(
              `❌ Failed to register validators:`,
              regError instanceof Error ? regError.message : String(regError),
            );
          }
        }

        // if after this last polling there are no remaining non-activated validators, exit
        if (filterPendingOnly(storedState).length === 0) {
          console.log("✅ All pending validators have been activated!");
          console.log("💾 Clearing validators.json");
          saveValidatorStatuses({});
          process.exit(0);
        }

        console.log("⏱️  Next poll in 12 minutes: ", nextEpochTime());
        await new Promise((resolve) =>
          setTimeout(resolve, EPOCH_LENGHT_MILLISECONDS),
        );
      } catch (error) {
        console.error(
          `❌ Error during polling: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.log("⏱️  Waiting for next interval...");
        await new Promise((resolve) =>
          setTimeout(resolve, EPOCH_LENGHT_MILLISECONDS),
        );
      }
    }
  } catch (error) {
    console.error(
      `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

await main();
